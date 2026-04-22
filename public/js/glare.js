/**
 * Dynamic Glare System
 * Tracks mouse/touch and exposes CSS custom properties for glass highlight effects.
 */
const Glare = {
    x: 50,
    y: 50,
    targetX: 50,
    targetY: 50,
    active: false,

    init() {
        document.body.style.setProperty('--glare-x', '50%');
        document.body.style.setProperty('--glare-y', '50%');
        document.body.style.setProperty('--glare-opacity', '0');

        const update = (clientX, clientY) => {
            this.targetX = (clientX / window.innerWidth) * 100;
            this.targetY = (clientY / window.innerHeight) * 100;
            this.active = true;
        };

        window.addEventListener('mousemove', (e) => update(e.clientX, e.clientY));

        window.addEventListener('mouseleave', () => {
            this.active = false;
        });

        this.animate();
    },

    animate() {
        // Smooth lerp
        this.x += (this.targetX - this.x) * 0.08;
        this.y += (this.targetY - this.y) * 0.08;

        document.body.style.setProperty('--glare-x', this.x.toFixed(1) + '%');
        document.body.style.setProperty('--glare-y', this.y.toFixed(1) + '%');
        document.body.style.setProperty('--glare-opacity', this.active ? '1' : '0');

        requestAnimationFrame(() => this.animate());
    }
};

document.addEventListener('DOMContentLoaded', () => Glare.init());
