import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class EarthMap {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        
        this.globe = null;
        this.points = [];
        this.controls = null;
        
        this.init();
    }

    init() {
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.container.appendChild(this.renderer.domElement);

        this.camera.position.z = 220;

        // Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
        this.scene.add(ambientLight);

        const dLight = new THREE.DirectionalLight(0xffffff, 1);
        dLight.position.set(5, 3, 5);
        this.scene.add(dLight);

        // Globe - significantly smaller radius as requested
        const geometry = new THREE.SphereGeometry(60, 64, 64);
        const textureLoader = new THREE.TextureLoader();
        
        // Using a high-quality night earth texture
        const earthTexture = textureLoader.load('https://unpkg.com/three-globe/example/img/earth-night.jpg');
        
        const material = new THREE.MeshPhongMaterial({
            map: earthTexture,
            color: 0xffffff, // Keep white to let texture show its colors
            emissive: 0x111122,
            specular: 0x333333,
            shininess: 5,
            transparent: true,
            opacity: 0.95
        });

        this.globe = new THREE.Mesh(geometry, material);
        this.scene.add(this.globe);
        
        // Standard rotation to put Europe/Africa in view
        this.globe.rotation.y = -Math.PI / 2;



        // Controls
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.rotateSpeed = 0.5;
        this.controls.enableZoom = false; // Disable zoom to keep it consistent
        this.controls.autoRotate = true;
        this.controls.autoRotateSpeed = 0.5;

        window.addEventListener('resize', () => this.onWindowResize());
        this.animate();
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    setPoints(points) {
        // Clear old points
        this.points.forEach(p => this.scene.remove(p));
        this.points = [];

    setPoints(points, currentUserId) {
        // Clear old points
        this.points.forEach(p => {
            if (p.parent) p.parent.remove(p);
        });
        this.points = [];

        points.forEach(pos => {
            const isMe = String(pos.id) === String(currentUserId);
            
            // Me is green, others are red
            const color = isMe ? 0x00ff88 : 0xff3366;
            const size = isMe ? 2.5 : 1.5; // Make "Me" slightly bigger

            const pointGeometry = new THREE.SphereGeometry(size, 16, 16);
            const pointMaterial = new THREE.MeshBasicMaterial({ color });
            
            const point = new THREE.Mesh(pointGeometry, pointMaterial);
            const coords = this.latLngToVector3(pos.lat, pos.lng, 61);
            point.position.copy(coords);
            
            this.globe.add(point);
            this.points.push(point);
        });
    }

    latLngToVector3(lat, lng, radius) {
        // Corrected mapping for unpkg earth-night texture
        const phi = (90 - lat) * (Math.PI / 180);
        const theta = (lng + 180) * (Math.PI / 180);

        const x = -radius * Math.sin(phi) * Math.cos(theta);
        const z = radius * Math.sin(phi) * Math.sin(theta);
        const y = radius * Math.cos(phi);

        return new THREE.Vector3(x, y, z);
    }
    
    focusUser(lat, lng) {
        const coords = this.latLngToVector3(lat, lng, 105); // Zoomed in focus (globe R=60)
        
        // CRITICAL: Must rotate the target coordinates by the same angle the globe is rotated
        const angle = this.globe.rotation.y;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        
        const rx = coords.x * cosA - coords.z * sinA;
        const rz = coords.x * sinA + coords.z * cosA;
        
        this.camera.position.set(rx, coords.y, rz);
        this.camera.lookAt(0, 0, 0);
        
        this.controls.autoRotate = false;
        this.controls.update();
    }
}
