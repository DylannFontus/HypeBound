/**
 * Three.js scene setup for the battle board.
 *
 * Camera sits above and behind the player's side at a shallow tilt, giving the
 * "slightly more 3D, slightly more top-down" look: cards read almost flat, but
 * the board has real depth, parallax and specular response.
 *
 * Quality tiers degrade gracefully — the low tier drops bloom, shadows and
 * particle counts so mid-range phones hold the 30fps floor.
 */

import * as THREE from "three";

export type QualityTier = "high" | "medium" | "low";

export interface SceneQuality {
  tier: QualityTier;
  bloom: boolean;
  shadows: boolean;
  maxParticles: number;
  pixelRatioCap: number;
}

export const QUALITY_PRESETS: Record<QualityTier, SceneQuality> = {
  high: { tier: "high", bloom: true, shadows: true, maxParticles: 420, pixelRatioCap: 2 },
  medium: { tier: "medium", bloom: true, shadows: false, maxParticles: 200, pixelRatioCap: 1.5 },
  low: { tier: "low", bloom: false, shadows: false, maxParticles: 70, pixelRatioCap: 1 },
};

/** Pick a starting tier from what the device advertises. */
export function detectQuality(): QualityTier {
  if (typeof navigator === "undefined") return "medium";
  const memory = (navigator as { deviceMemory?: number }).deviceMemory ?? 4;
  const cores = navigator.hardwareConcurrency ?? 4;
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  if (coarse && (memory <= 4 || cores <= 4)) return "low";
  if (memory <= 4 || cores <= 4) return "medium";
  return "high";
}

/**
 * World-space board layout, derived from measurements of the reference footage.
 *
 * `width` is the load-bearing number here. Frame-by-frame measurement of the
 * reference put its playable ground at 61.4% of screen width, sitting inside a
 * decorated stone border that reaches 71.6%. Our mat had been 72.5% — sized
 * like the reference's *border* but painted like its *ground*, which left a
 * broad empty apron on both flanks and made any small row look marooned in the
 * middle. That, not the pitch, is why the board read as clustered: at every
 * card count our row already spanned a larger fraction of the mat than the
 * reference's does (36% vs 33% at three units). Narrowing the mat to 21 units
 * puts the ground at 60.9% and lifts a three-card row to 45% of it.
 *
 * Vertical positions follow the reference's measured bands, converted at
 * 5.155% of screen height per world unit:
 *   enemy leader 17.6% | enemy row 37.5% | player row 54%+ | player leader 75.8%
 *
 * The one deliberate deviation is row separation. We put full cards on the
 * board where the reference puts stripped medallions, and a card is a third
 * taller, so the rows sit as close as the card height allows (0.70 clearance)
 * rather than exactly on the reference's 3.28-unit spacing.
 */
export const BOARD = {
  width: 21,
  depth: 17.6,
  /** z of each character row (negative is toward the enemy) */
  enemyRowZ: -2.4,
  playerRowZ: 1.75,
  /** leader medallions, on the centre line bracketing the rows */
  enemyLeaderZ: -6.3,
  playerLeaderZ: 5,
  leaderX: 0,
  /**
   * Height of the leader medallion's plane. It is landscape (see renderLeader),
   * so this is the short axis; the disc itself is ~90% of it.
   */
  leaderHeight: 2.2,
  /** board card footprint (0.753 aspect) and row centre-to-centre spacing */
  cardWidth: 2.6,
  cardHeight: 3.45,
  /**
   * Deliberately looser than the reference's measured 1.20 pitch-to-width. The
   * reference welds its row into one block; this project's brief asks for cards
   * that sit beside each other rather than clumped, so 1.38 is a considered
   * departure, not an oversight.
   */
  tokenSpacing: 3.6,
  /**
   * The widest a full row may span before cards tighten up. Sized so six cards
   * still leave a 0.35 gutter between neighbours and 1.8 units of mat either
   * side, rather than crushing together at the edges.
   */
  slotSpan: 17.7,
  /**
   * Releasing a dragged card beyond this z is a CANCEL -- the strip of arena
   * nearest the player, where the hand overlaps the board.
   */
  cancelZ: 7.4,
} as const;

export interface BattleSceneHandles {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  quality: SceneQuality;
  /** groups the view populates */
  boardGroup: THREE.Group;
  cardGroup: THREE.Group;
  handGroup: THREE.Group;
  fxGroup: THREE.Group;
  render: (elapsed: number) => void;
  resize: () => void;
  dispose: () => void;
  setQuality: (tier: QualityTier) => void;
  /** Show a board backdrop behind the scene, or null for the flat void. */
  setBackdrop: (image: HTMLImageElement | null) => void;
  /** screen-space projection helper for anchoring DOM overlays to 3D objects */
  project: (position: THREE.Vector3) => { x: number; y: number };
  raycastFromPointer: (clientX: number, clientY: number, objects: THREE.Object3D[]) => THREE.Intersection[];
}

/**
 * A texture-sized copy of a backdrop.
 *
 * The masters are 3840x2160, which is about 33 MB of video memory once uploaded
 * as RGBA — for a still image that sits behind fog and never moves. Halving the
 * long edge quarters that to roughly 8 MB and is indistinguishable at any
 * viewport this game runs at, because the backdrop is never shown at 1:1.
 *
 * Returns the original when it is already small enough, so a hand-made 1080p
 * board is used as-is rather than pointlessly re-encoded.
 */
const MAX_BACKDROP_WIDTH = 1920;

function shrinkForTexture(image: HTMLImageElement): HTMLImageElement | HTMLCanvasElement {
  if (image.naturalWidth <= MAX_BACKDROP_WIDTH) return image;
  const scale = MAX_BACKDROP_WIDTH / image.naturalWidth;
  const canvas = document.createElement("canvas");
  canvas.width = MAX_BACKDROP_WIDTH;
  canvas.height = Math.round(image.naturalHeight * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return image;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function createBattleScene(container: HTMLElement, tier: QualityTier = detectQuality()): BattleSceneHandles {
  let quality = QUALITY_PRESETS[tier];

  const renderer = new THREE.WebGLRenderer({
    antialias: quality.tier !== "low",
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setClearColor(0x05030b, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = quality.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.touchAction = "none";

  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x07040f, 0.028);

  // --- camera: the signature shallow top-down tilt --------------------------
  /**
   * ORTHOGRAPHIC, deliberately.
   *
   * The reference board is a flat arena read from above. Under a perspective
   * camera a board that deep skews into a trapezoid — the far row renders
   * narrower than the near one and tokens away from centre lean outward. A
   * parallel projection removes that entirely: the arena stays a true
   * rectangle, every token is the same size wherever it sits, and hit-testing
   * matches what the player sees. The slight camera tilt still foreshortens z
   * for a hint of depth, but uniformly, with no distortion.
   */
  const VIEW_HEIGHT = 19.4; // world units of board depth framed vertically
  const camera = new THREE.OrthographicCamera(-10, 10, 6.7, -6.7, 0.1, 140);
  camera.position.set(0, 24, 4.4);
  camera.lookAt(0, 0, 0);

  // --- board backdrop -------------------------------------------------------
  /**
   * The backdrop is a quad parented to the camera, **not** a DOM layer behind
   * the canvas.
   *
   * The DOM version is the obvious design and it does not work here. It needs a
   * transparent canvas, and this renderer draws through an `EffectComposer` for
   * bloom: the composer renders into its own targets and writes them to the
   * screen, so `setClearColor(…, 0)` on the renderer never reaches the output
   * and the canvas stays opaque. Measured, not assumed — with the host element
   * painted bright red behind a supposedly transparent canvas, the pixels came
   * back pure black.
   *
   * Inside the scene there is nothing to negotiate with. It composites where
   * everything else does, the composer processes it like any other geometry,
   * and the canvas stays fully opaque exactly as it always was.
   *
   * Parented to the camera so it needs no world-space maths: it sits at a fixed
   * distance in front of the lens and is scaled to the frustum, which under an
   * orthographic projection is a constant. `scene.add(camera)` is required for
   * a camera's children to be traversed at all.
   */
  scene.add(camera);

  let backdropMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;

  /**
   * Scale the quad to the frustum and crop the texture like CSS `cover`.
   *
   * Letterboxing would be the alternative and it is wrong for a backdrop —
   * bars at the edge of a game board read as a broken layout, not as a choice.
   * The brief tells the artist the outer 12% may be cropped; this is what crops
   * it.
   */
  function fitBackdrop(): void {
    if (!backdropMesh) return;
    const viewWidth = (camera.right - camera.left) / camera.zoom;
    const viewHeight = (camera.top - camera.bottom) / camera.zoom;
    backdropMesh.scale.set(viewWidth, viewHeight, 1);

    const texture = backdropMesh.material.map;
    const source = texture?.image as { width?: number; height?: number } | undefined;
    if (!texture || !source?.width || !source.height) return;

    const imageAspect = source.width / source.height;
    const viewAspect = viewWidth / viewHeight;
    if (viewAspect > imageAspect) {
      const shown = imageAspect / viewAspect;
      texture.repeat.set(1, shown);
      texture.offset.set(0, (1 - shown) / 2);
    } else {
      const shown = viewAspect / imageAspect;
      texture.repeat.set(shown, 1);
      texture.offset.set((1 - shown) / 2, 0);
    }
  }

  function clearBackdrop(): void {
    if (!backdropMesh) return;
    camera.remove(backdropMesh);
    backdropMesh.geometry.dispose();
    backdropMesh.material.map?.dispose();
    backdropMesh.material.dispose();
    backdropMesh = null;
  }

  /**
   * Show a backdrop, or go back to the flat void.
   *
   * Null restores exactly the original look, which is what every board without
   * a picture gets.
   */
  function setBackdrop(image: HTMLImageElement | null): void {
    clearBackdrop();
    if (!image) return;

    const texture = new THREE.Texture(shrinkForTexture(image));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;

    backdropMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: texture,
        // Behind everything, and taking no part in depth.
        depthTest: false,
        depthWrite: false,
        // Fog would drag the whole picture toward the fog colour, which is the
        // flat void this exists to replace.
        fog: false,
      })
    );
    backdropMesh.renderOrder = -1;
    // Far enough forward to be inside the near plane, far enough back that
    // nothing in the scene can intersect it.
    backdropMesh.position.set(0, 0, -60);
    camera.add(backdropMesh);
    fitBackdrop();
  }

  // --- lighting -------------------------------------------------------------
  const ambient = new THREE.AmbientLight(0x8878c8, 1.5);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.9);
  keyLight.position.set(-6, 14, 7);
  if (quality.shadows) {
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 4;
    keyLight.shadow.camera.far = 34;
    keyLight.shadow.camera.left = -11;
    keyLight.shadow.camera.right = 11;
    keyLight.shadow.camera.top = 9;
    keyLight.shadow.camera.bottom = -9;
    keyLight.shadow.bias = -0.0012;
  }
  scene.add(keyLight);

  // magenta rim from the player's side, cyan from the enemy's — the nightlife look
  const rimWarm = new THREE.PointLight(0xff5fa2, 34, 26, 2);
  rimWarm.position.set(6.4, 3.4, 5.6);
  scene.add(rimWarm);

  const rimCool = new THREE.PointLight(0x52c8ff, 30, 26, 2);
  rimCool.position.set(-6.4, 3.4, -5.2);
  scene.add(rimCool);

  const overhead = new THREE.SpotLight(0xd9a5ff, 42, 30, Math.PI / 5, 0.55, 1.6);
  overhead.position.set(0, 13, 0.5);
  overhead.target.position.set(0, 0, -0.5);
  scene.add(overhead);
  scene.add(overhead.target);

  // --- groups ---------------------------------------------------------------
  const boardGroup = new THREE.Group();
  const cardGroup = new THREE.Group();
  const handGroup = new THREE.Group();
  const fxGroup = new THREE.Group();
  scene.add(boardGroup, cardGroup, handGroup, fxGroup);

  // --- post-processing (bloom) ---------------------------------------------
  let composer: import("three/examples/jsm/postprocessing/EffectComposer.js").EffectComposer | null = null;
  let bloomPass: import("three/examples/jsm/postprocessing/UnrealBloomPass.js").UnrealBloomPass | null = null;

  const setupComposer = async (): Promise<void> => {
    if (!quality.bloom) {
      composer = null;
      return;
    }
    try {
      const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
        import("three/examples/jsm/postprocessing/EffectComposer.js"),
        import("three/examples/jsm/postprocessing/RenderPass.js"),
        import("three/examples/jsm/postprocessing/UnrealBloomPass.js"),
        import("three/examples/jsm/postprocessing/OutputPass.js"),
      ]);
      const next = new EffectComposer(renderer);
      next.addPass(new RenderPass(scene, camera));
      bloomPass = new UnrealBloomPass(
        new THREE.Vector2(container.clientWidth || 1280, container.clientHeight || 720),
        quality.tier === "high" ? 0.52 : 0.36,
        0.72,
        0.82
      );
      next.addPass(bloomPass);
      next.addPass(new OutputPass());
      composer = next;
      resize();
    } catch {
      // bloom is a nicety — if the example modules fail to load we render plain
      composer = null;
    }
  };
  void setupComposer();

  // --- sizing ---------------------------------------------------------------
  function resize(): void {
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, quality.pixelRatioCap);

    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    composer?.setPixelRatio(dpr);
    composer?.setSize(width, height);

    // Frame a fixed slice of board depth vertically; width follows the aspect.
    // On very wide viewports that leaves margins either side, exactly like the
    // reference's decorative border — the board never stretches.
    const aspect = width / Math.max(1, height);
    const halfHeight = VIEW_HEIGHT / 2;
    const halfWidth = halfHeight * aspect;

    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.left = -halfWidth;
    camera.right = halfWidth;

    // if the board would overflow horizontally, zoom out until it fits
    const needed = (BOARD.width + 1.6) / 2;
    camera.zoom = halfWidth < needed ? halfWidth / needed : 1;
    camera.updateProjectionMatrix();
    fitBackdrop();
  }
  resize();

  const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => resize()) : null;
  resizeObserver?.observe(container);
  window.addEventListener("resize", resize);

  // --- render ---------------------------------------------------------------
  function render(elapsed: number): void {
    // gentle light breathing keeps the board alive without distracting motion
    rimWarm.intensity = 30 + Math.sin(elapsed * 0.9) * 5;
    rimCool.intensity = 27 + Math.cos(elapsed * 0.7) * 5;

    if (composer) composer.render();
    else renderer.render(scene, camera);
  }

  // --- helpers --------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  function raycastFromPointer(clientX: number, clientY: number, objects: THREE.Object3D[]): THREE.Intersection[] {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(objects, true);
  }

  const projectVec = new THREE.Vector3();
  function project(position: THREE.Vector3): { x: number; y: number } {
    projectVec.copy(position).project(camera);
    const rect = renderer.domElement.getBoundingClientRect();
    return {
      x: ((projectVec.x + 1) / 2) * rect.width,
      y: ((1 - projectVec.y) / 2) * rect.height,
    };
  }

  function setQuality(nextTier: QualityTier): void {
    quality = QUALITY_PRESETS[nextTier];
    renderer.shadowMap.enabled = quality.shadows;
    keyLight.castShadow = quality.shadows;
    void setupComposer();
    resize();
  }

  function dispose(): void {
    resizeObserver?.disconnect();
    window.removeEventListener("resize", resize);
    composer?.dispose?.();
    renderer.dispose();
    renderer.domElement.remove();
    clearBackdrop();
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material?.dispose();
    });
  }

  return {
    renderer,
    scene,
    camera,
    get quality() {
      return quality;
    },
    boardGroup,
    cardGroup,
    handGroup,
    fxGroup,
    render,
    resize,
    dispose,
    setQuality,
    setBackdrop,
    project,
    raycastFromPointer,
  } as BattleSceneHandles;
}
