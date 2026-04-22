import * as THREE from 'three';

export class FloatingAvatars {
    constructor(canvasId) {
        this.container = document.getElementById('app');
        this.oldCanvas = document.getElementById(canvasId);

        if (this.oldCanvas) {
            this.oldCanvas.style.display = 'none';
        }

        this.isRolling = false;
        this.avatars = [];
        this.avatarCount = 40;
        this.bokehCount = 8;
        this.totalCount = this.avatarCount + this.bokehCount;
        this.mouse = new THREE.Vector2(-10000, -10000);
        this.targetMouse = new THREE.Vector2(-10000, -10000);
        this.isKeyboardVisible = false;

        this.initThree();
        if (!this.webglReady) {
            console.warn('FloatingAvatars: 3D background disabled due to WebGL issues.');
            return;
        }

        this.initTextures();
        this.initAvatars();
        this.initInteraction();
        this.animate();

        window.addEventListener('resize', this.resize.bind(this));
    }

    initThree() {
        try {
            this.scene = new THREE.Scene();

            this.camera = new THREE.OrthographicCamera(
                -window.innerWidth / 2, window.innerWidth / 2,
                0, -window.innerHeight,
                0.1, 1000
            );
            this.camera.position.z = 100;

            // Robust WebGL Check before THREE initialization
            const canvasTest = document.createElement('canvas');
            let gl = null;
            try {
                gl = canvasTest.getContext('webgl', { failIfMajorPerformanceCaveat: true }) ||
                    canvasTest.getContext('experimental-webgl');
            } catch (e) { }

            if (!gl || gl.isContextLost()) {
                this.webglReady = false;
                return;
            }

            // Safe precision check to avoid Three.js internal crashes
            // Use optional chaining to prevent TypeError if getShaderPrecisionFormat returns null
            const precision = gl.getShaderPrecisionFormat(gl.VERTEX_SHADER, gl.HIGH_FLOAT);
            const hasHighPrecision = precision && (precision.precision > 0);

            const options = {
                alpha: true,
                antialias: false,
                failIfMajorPerformanceCaveat: true,
                powerPreference: "high-performance",
                precision: hasHighPrecision ? 'highp' : 'mediump'
            };

            try {
                this.renderer = new THREE.WebGLRenderer(options);

                // Immediate check if renderer survived initialization
                if (!this.renderer.getContext() || this.renderer.getContext().isContextLost()) {
                    throw new Error('Context lost during WebGLRenderer creation');
                }
            } catch (err) {
                this.webglReady = false;
                if (this.renderer) {
                    this.renderer.dispose();
                    this.renderer = null;
                }
                return;
            }

            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            this.renderer.setSize(window.innerWidth, window.innerHeight);

            const canvas = this.renderer.domElement;
            canvas.style.position = 'fixed';
            canvas.style.top = '0';
            canvas.style.left = '0';
            canvas.style.width = '100%';
            canvas.style.height = '100%';
            canvas.style.zIndex = '0';
            canvas.style.pointerEvents = 'none';

            this.container.insertBefore(canvas, this.container.firstChild);
            this.webglReady = true;

            // Handle context loss gracefully
            canvas.addEventListener('webglcontextlost', (event) => {
                event.preventDefault();
                console.warn('WebGL context lost. 3D background suspended.');
                this.webglReady = false;
            }, false);

            canvas.addEventListener('webglcontextrestored', () => {
                console.log('WebGL context restored. Re-initializing engine...');
                this.initTextures();
                this.initAvatars();
                this.webglReady = true;
            }, false);

        } catch (e) {
            this.webglReady = false;
        }
    }

    resize() {
        if (!this.camera || !this.renderer) return;

        this.camera.left = -window.innerWidth / 2;
        this.camera.right = window.innerWidth / 2;
        this.camera.top = 0;
        this.camera.bottom = -window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    setKeyboardVisible(visible) {
        this.isKeyboardVisible = visible;
        // No longer locking height via JS to avoid "squishing"
        // The camera re-anchoring to top=0 handles the shift gracefully
    }

    // Single clean texture — soft radial dot, identical to the original Canvas2D gradient
    _makeDotTexture() {
        const size = 128;
        const c = document.createElement('canvas');
        c.width = size; c.height = size;
        const ctx = c.getContext('2d');
        const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        g.addColorStop(0, 'rgba(255,255,255,1.0)');
        g.addColorStop(0.4, 'rgba(255,255,255,0.4)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);
        return new THREE.CanvasTexture(c);
    }

    initTextures() {
        this.dotTexture = this._makeDotTexture();
    }

    initAvatars() {
        const palette = [
            { r: 139, g: 92, b: 246 }, // purple
            { r: 56, g: 189, b: 248 }, // cyan
            { r: 168, g: 85, b: 247 }, // violet
            { r: 99, g: 102, b: 241 }, // indigo
            { r: 236, g: 72, b: 153 }, // pink
            { r: 34, g: 211, b: 238 }  // teal
        ];

        const w = window.innerWidth;
        const h = window.innerHeight;

        this.avatarGroup = new THREE.Group();
        this.scene.add(this.avatarGroup);

        for (let i = 0; i < this.totalCount; i++) {
            const isBokeh = i >= this.avatarCount;
            const c = palette[i % palette.length];
            const color = new THREE.Color(c.r / 255, c.g / 255, c.b / 255);

            // Particle sizes — larger for more visual presence
            const radius = isBokeh
                ? (30 + Math.random() * 40)
                : (5 + Math.random() * 11);

            // Single sprite per particle — clean, no layering artifacts
            const mat = new THREE.SpriteMaterial({
                map: this.dotTexture,
                color,
                transparent: true,
                opacity: isBokeh ? 0.35 : 0.6,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                depthTest: false
            });
            const sprite = new THREE.Sprite(mat);
            // Scale reduced significantly
            const visualSize = isBokeh ? radius * 2 : radius * 3;
            sprite.scale.set(visualSize, visualSize, 1);

            sprite.position.set(
                (Math.random() - 0.5) * w,
                -Math.random() * h,
                isBokeh ? -5 : i * 0.05
            );
            this.avatarGroup.add(sprite);

            this.avatars.push({
                sprite,
                x: sprite.position.x,
                y: sprite.position.y,
                vx: (Math.random() - 0.5) * 0.8,
                vy: (Math.random() - 0.5) * 0.8,
                radius,
                pulse: Math.random() * Math.PI * 2,
                pulseSpeed: 0.02 + Math.random() * 0.03,
                opacity: isBokeh ? (0.15 + Math.random() * 0.15) : (0.5 + Math.random() * 0.4),
                drift: Math.random() * Math.PI * 2,
                driftSpeed: isBokeh ? (0.001 + Math.random() * 0.002) : (0.003 + Math.random() * 0.005),
                isBokeh
            });
        }
    }

    initInteraction() {
        const handleMove = (e) => {
            let cx, cy;
            if (e.touches && e.touches[0]) {
                cx = e.touches[0].clientX;
                cy = e.touches[0].clientY;
            } else {
                cx = e.clientX;
                cy = e.clientY;
            }
            this.targetMouse.x = cx - window.innerWidth / 2;
            this.targetMouse.y = -cy;
        };

        const handleEnd = () => {
            this.targetMouse.set(-10000, -10000);
        };

        window.addEventListener('mousemove', handleMove);
        window.addEventListener('mouseleave', handleEnd);
        window.addEventListener('touchstart', handleMove, { passive: true });
        window.addEventListener('touchmove', handleMove, { passive: true });
        window.addEventListener('touchend', handleEnd);
    }

    updatePhysics() {
        this.mouse.lerp(this.targetMouse, 0.1);

        const speedMult = this.isRolling ? 6 : 1;
        const w = window.innerWidth;
        const h = window.innerHeight;

        for (const a of this.avatars) {
            // Organic drift
            a.drift += a.driftSpeed;
            if (!this.isRolling) {
                a.vx += Math.sin(a.drift) * 0.008;
                a.vy += Math.cos(a.drift * 0.7) * 0.008;
                a.vx += (Math.random() - 0.5) * 0.02;
                a.vy += (Math.random() - 0.5) * 0.02;
            }

            // Mouse repulsion
            if (this.targetMouse.x > -9000 && !this.isRolling) {
                const mdx = a.x - this.mouse.x;
                const mdy = a.y - this.mouse.y;
                const mdist = Math.sqrt(mdx * mdx + mdy * mdy);
                const forceRange = 180;
                if (mdist < forceRange && mdist > 0) {
                    const force = (forceRange - mdist) / forceRange;
                    a.vx += (mdx / mdist) * force * 1.5;
                    a.vy += (mdy / mdist) * force * 1.5;
                }
            }

            // Damping
            const drag = this.isRolling ? 0.98 : 0.97;
            a.vx *= drag;
            a.vy *= drag;

            // Speed cap
            const maxSpeed = this.isRolling ? 8 : 1.5;
            const speed = Math.sqrt(a.vx * a.vx + a.vy * a.vy);
            if (speed > maxSpeed) {
                a.vx = (a.vx / speed) * maxSpeed;
                a.vy = (a.vy / speed) * maxSpeed;
            }

            a.x += a.vx * speedMult;
            a.y += a.vy * speedMult;
            a.pulse += a.pulseSpeed;

            // Wrap
            const margin = a.radius * 2;
            if (a.x < -w / 2 - margin) a.x = w / 2 + margin;
            if (a.x > w / 2 + margin) a.x = -w / 2 - margin;
            if (a.y < -h - margin) a.y = 0 + margin;
            if (a.y > 0 + margin) a.y = -h - margin;

            // Pulse
            const pulseFactor = 1 + Math.sin(a.pulse) * 0.15;
            const r = a.radius * pulseFactor;
            const alpha = a.opacity * (0.8 + Math.sin(a.pulse * 0.5) * 0.2);

            // Update sprite
            a.sprite.position.x = a.x;
            a.sprite.position.y = a.y;

            // Maintain the new smaller scale during pulse
            const vs = a.isBokeh ? r * 2 : r * 3;
            a.sprite.scale.set(vs, vs, 1);
            a.sprite.material.opacity = alpha;
        }
    }

    animate() {
        requestAnimationFrame(this.animate.bind(this));
        if (!this.webglReady) return; // Guard for WebGL context

        if (this.isRolling) {
            this.camera.position.x = (Math.random() - 0.5) * 1.5;
            this.camera.position.y = (Math.random() - 0.5) * 1.5;
        } else {
            this.camera.position.x = 0;
            this.camera.position.y = 0;
        }

        this.updatePhysics();
        this.renderer.render(this.scene, this.camera);
    }

    roll(callback) {
        if (this.isRolling) return;
        this.isRolling = true;

        const w = window.innerWidth;
        const h = window.innerHeight;

        this.avatars.forEach(a => {
            a.x = (Math.random() - 0.5) * w;
            a.y = -Math.random() * h;
            a.vx += (Math.random() - 0.5) * 6;
            a.vy += (Math.random() - 0.5) * 6;
        });

        setTimeout(() => {
            this.isRolling = false;
            this.camera.position.x = 0;
            this.camera.position.y = 0;
            if (callback) callback();
        }, 2500);
    }
}
