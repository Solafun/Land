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

        this.isRotatingToUser = false;
        this.targetGlobeRotationY = null;

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
        this.controls.enableZoom = false; // Disable zoom
        this.controls.enablePan = false;  // Disable panning (moving it around)
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
        
        // Smooth globe rotation to user's location (no zoom)
        if (this.isRotatingToUser && this.targetGlobeRotationY !== undefined) {
            const current = this.globe.rotation.y;
            const target = this.targetGlobeRotationY;
            const newY = current + (target - current) * 0.06;
            this.globe.rotation.y = newY;
            
            if (Math.abs(target - newY) < 0.005) {
                this.globe.rotation.y = target;
                this.isRotatingToUser = false;
                // Resume gentle auto-rotation after 3 seconds
                setTimeout(() => { this.controls.autoRotate = true; }, 3000);
            }
        }

        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    setPoints(points, currentUserId) {
        // Clear old points
        if (this.points && this.points.length > 0) {
            for (let p of this.points) {
                if (p.parent) p.parent.remove(p);
                if (p.geometry) p.geometry.dispose();
                if (p.material) {
                    if (p.material.map) p.material.map.dispose();
                    p.material.dispose();
                }
            }
        }
        this.points = [];

        if (!points || points.length === 0) return;
        console.log(`Globe: Rendering ${points.length} points, currentUserId=${currentUserId}`);

        // Create person icon textures via canvas
        const meTexture = this._createPersonTexture(true);
        const otherTexture = this._createPersonTexture(false);

        points.forEach(pos => {
            const isMe = String(pos.id) === String(currentUserId);
            
            const spriteMaterial = new THREE.SpriteMaterial({ 
                map: isMe ? meTexture : otherTexture,
                transparent: true,
                depthTest: false,
                sizeAttenuation: true
            });
            const sprite = new THREE.Sprite(spriteMaterial);
            sprite.scale.set(isMe ? 6 : 4, isMe ? 6 : 4, 1);
            
            const coords = this.latLngToVector3(pos.lat, pos.lng, isMe ? 63 : 62);
            sprite.position.copy(coords);
            this.globe.add(sprite);
            this.points.push(sprite);
        });
    }

    _createPersonTexture(isMe) {
        const size = 64;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        // Glow circle
        const cx = size / 2;
        const cy = size / 2;
        const r = size / 2 - 4;

        // Outer glow
        const gradient = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r);
        if (isMe) {
            gradient.addColorStop(0, 'rgba(100, 220, 255, 0.9)');
            gradient.addColorStop(0.6, 'rgba(60, 180, 255, 0.4)');
            gradient.addColorStop(1, 'rgba(60, 180, 255, 0)');
        } else {
            gradient.addColorStop(0, 'rgba(255, 255, 255, 0.7)');
            gradient.addColorStop(0.6, 'rgba(200, 200, 220, 0.3)');
            gradient.addColorStop(1, 'rgba(200, 200, 220, 0)');
        }
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();

        // Person silhouette
        const color = isMe ? '#e0f7ff' : '#d0d0e0';
        ctx.fillStyle = color;
        // Head
        ctx.beginPath();
        ctx.arc(cx, cy - 6, 7, 0, Math.PI * 2);
        ctx.fill();
        // Body
        ctx.beginPath();
        ctx.arc(cx, cy + 10, 10, Math.PI, 0);
        ctx.fill();

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        return texture;
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
        // Rotate globe so the user's point faces the camera, WITHOUT zooming
        const targetRotationY = -lng * (Math.PI / 180) - Math.PI / 2;
        
        // Smoothly animate the rotation
        const startRotation = this.globe.rotation.y;
        const diff = targetRotationY - startRotation;
        // Normalize to shortest path
        const normalizedDiff = ((diff + Math.PI) % (Math.PI * 2)) - Math.PI;
        this.targetGlobeRotationY = startRotation + normalizedDiff;
        this.isRotatingToUser = true;
        this.controls.autoRotate = false;
    }
}
