import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface MeshPieceData {
  row: number;
  col: number;
  positions: Float32Array;
  indices: Uint32Array;
  colors?: Float32Array; 
}

export class ThreeViewManager {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private meshGroup: THREE.Group;
  private container: HTMLElement;

  constructor(containerId: string) {
    const el = document.getElementById(containerId);
    if (!el) throw new Error(`Container not found`);
    this.container = el;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#323232'); 

    this.camera = new THREE.PerspectiveCamera(45, 1, 1, 5000);
    this.camera.position.set(0, -350, 300);
    this.camera.up.set(0, 0, 1); 

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    this.setupLighting();
    
    this.meshGroup = new THREE.Group();
    this.scene.add(this.meshGroup);

    window.addEventListener('resize', this.onWindowResize.bind(this));
    setTimeout(() => this.onWindowResize(), 100);
    this.animate();
  }

  private setupLighting() {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambientLight);
    const mainLight = new THREE.DirectionalLight(0xfff4e5, 1.0);
    mainLight.position.set(150, -150, 200);
    this.scene.add(mainLight);
  }

  public renderMeshes(pieces: MeshPieceData[]) {
    if (this.renderer.domElement.width === 0) this.onWindowResize();

    while (this.meshGroup.children.length > 0) {
      const child = this.meshGroup.children[0] as THREE.Mesh;
      this.meshGroup.remove(child);
      if (child.geometry) child.geometry.dispose();
    }

    pieces.forEach(p => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(p.positions), 3));
      geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(p.indices), 1));
      
      if (p.colors && p.colors.length > 0) {
        geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(p.colors), 3));
      }
      geometry.computeVertexNormals();
      
      const material = new THREE.MeshStandardMaterial({
        vertexColors: !!p.colors,
        color: p.colors ? 0xffffff : 0xe0e0e0,
        roughness: 0.8, 
        side: THREE.DoubleSide
      });

      // INJECT CUSTOM SHADER: Clean Walls & Base
      material.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            '#include <common>\nvarying float vLocalZ;\nvarying vec3 vLocalNormal;\n'
        ).replace(
            '#include <begin_vertex>',
            '#include <begin_vertex>\nvLocalZ = position.z;\nvLocalNormal = normal;\n'
        );
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            '#include <common>\nvarying float vLocalZ;\nvarying vec3 vLocalNormal;\n'
        ).replace(
            '#include <color_fragment>',
            `#include <color_fragment>
             // Paint Earth Brown if strictly below the surface OR if facing sideways/downwards
             if (vLocalZ < 4.9 || vLocalNormal.z < 0.25) {
                 diffuseColor.rgb = vec3(101.0/255.0, 67.0/255.0, 33.0/255.0); 
             }`
        );
      };
      
      const mesh = new THREE.Mesh(geometry, material);
      this.meshGroup.add(mesh);
    });

    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  private onWindowResize() {
    if (!this.container || this.container.clientWidth === 0) return;
    this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
  }

  private animate = () => {
    requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}