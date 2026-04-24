/**
 * glare.js
 * Implements a dynamic glare effect that follows the cursor or touch.
 * Updates CSS variables used by glass cards and buttons.
 */
(function() {
    const root = document.documentElement;
    let isTouch = false;

    function updateGlare(e) {
        let x, y;
        if (e.touches && e.touches.length > 0) {
            x = e.touches[0].clientX;
            y = e.touches[0].clientY;
            isTouch = true;
        } else {
            x = e.clientX;
            y = e.clientY;
            isTouch = false;
        }

        root.style.setProperty('--glare-x', `${x}px`);
        root.style.setProperty('--glare-y', `${y}px`);
        root.style.setProperty('--glare-opacity', '1');
    }

    function hideGlare() {
        root.style.setProperty('--glare-opacity', '0');
    }

    window.addEventListener('mousemove', updateGlare, { passive: true });
    window.addEventListener('touchstart', updateGlare, { passive: true });
    window.addEventListener('touchmove', updateGlare, { passive: true });
    
    // Hide glare when mouse leaves window or touch ends
    window.addEventListener('mouseleave', hideGlare, { passive: true });
    window.addEventListener('touchend', () => {
        // Keep it visible for a moment then fade
        setTimeout(hideGlare, 500);
    }, { passive: true });

    // Initialize defaults
    root.style.setProperty('--glare-opacity', '0');
})();
