import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";

export default function ModelViewer({ model, token, apiUrl }) {
  const hostRef = useRef(null);
  const [state, setState] = useState({ loading: true, error: "" });

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !model) return undefined;

    let disposed = false;
    let frameId = 0;
    let object = null;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 10000);
    camera.position.set(3, 2.5, 4);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    host.replaceChildren(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.25;
    scene.add(new THREE.HemisphereLight(0xffffff, 0xcac6b7, 2.1));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.7);
    keyLight.position.set(4, 7, 5);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0x86a897, 1.1);
    fillLight.position.set(-5, 2, -3);
    scene.add(fillLight);

    function resize() {
      const width = host.clientWidth || 1;
      const height = host.clientHeight || 1;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    resize();

    async function loadModel() {
      setState({ loading: true, error: "" });
      try {
        const response = await fetch(`${apiUrl}/models/${model._id ?? model.id}/file`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(error.message ?? "This model could not be loaded.");
        }
        let loaded;
        if (model.format === "stl") {
          const geometry = new STLLoader().parse(await response.arrayBuffer());
          geometry.computeVertexNormals();
          loaded = new THREE.Mesh(
            geometry,
            new THREE.MeshStandardMaterial({ color: 0xd2a56e, roughness: 0.49, metalness: 0.04 })
          );
        } else {
          loaded = new OBJLoader().parse(await response.text());
          loaded.traverse((child) => {
            if (child.isMesh) {
              child.material = new THREE.MeshStandardMaterial({
                color: 0xd2a56e,
                roughness: 0.49,
                metalness: 0.04
              });
            }
          });
        }
        if (disposed) {
          disposeObject(loaded);
          return;
        }
        object = loaded;
        const bounds = new THREE.Box3().setFromObject(object);
        const center = bounds.getCenter(new THREE.Vector3());
        const size = bounds.getSize(new THREE.Vector3());
        object.position.sub(center);
        const largestSide = Math.max(size.x, size.y, size.z, 0.1);
        camera.position.set(largestSide * 1.8, largestSide * 1.25, largestSide * 2.1);
        camera.near = largestSide / 1000;
        camera.far = largestSide * 100;
        camera.updateProjectionMatrix();
        controls.target.set(0, 0, 0);
        controls.update();
        scene.add(object);
        setState({ loading: false, error: "" });
      } catch (error) {
        if (!disposed) setState({ loading: false, error: error.message });
      }
    }

    function render() {
      frameId = window.requestAnimationFrame(render);
      controls.update();
      renderer.render(scene, camera);
    }
    void loadModel();
    render();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      controls.dispose();
      if (object) disposeObject(object);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [apiUrl, model, token]);

  return (
    <div className="viewer">
      <div className="viewer-grid" aria-hidden="true" />
      <div ref={hostRef} className="viewer-canvas" />
      {!model && <div className="viewer-empty"><span className="cube-icon">◇</span><span>Your model appears here</span></div>}
      {model && state.loading && <div className="viewer-state">Preparing your model…</div>}
      {model && state.error && <div className="viewer-state viewer-error">{state.error}</div>}
      {model && !state.loading && !state.error && <div className="viewer-label"><span className="live-dot" /> INTERACTIVE PREVIEW <span className="viewer-hint">DRAG TO ROTATE</span></div>}
    </div>
  );
}

function disposeObject(object) {
  object.traverse((child) => {
    child.geometry?.dispose();
    if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose());
    else child.material?.dispose();
  });
}
