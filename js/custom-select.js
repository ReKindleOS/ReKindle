/**
 * Custom Select Dropdown for System 7 Aesthetics
 * Replaces native <select> elements with custom DOM elements to support rotation.
 */

class CustomSelect {
    constructor(selectElement) {
        this.selectElement = selectElement;
        this.customSelect = null;
        this.selectedDisplay = null;
        this.optionsList = null;
        this.isOpen = false;
        this.observer = null;

        this.init();
    }

    init() {
        // Hide original select
        this.selectElement.style.display = 'none';

        // Create Container
        this.customSelect = document.createElement('div');
        this.customSelect.className = 'custom-select-container';

        // Create Selected Display (The Button)
        this.selectedDisplay = document.createElement('div');
        this.selectedDisplay.className = 'custom-select-trigger';
        this.selectedDisplay.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });

        // Add arrow icon to trigger
        const arrow = document.createElement('span');
        arrow.className = 'custom-arrow';
        arrow.innerHTML = '&#9660;'; // Down triangle
        this.selectedDisplay.appendChild(arrow);

        // Add text node container (so we don't wipe arrow)
        const textSpan = document.createElement('span');
        textSpan.className = 'custom-trigger-text';
        this.selectedDisplay.insertBefore(textSpan, arrow);

        // Create Options List
        this.optionsList = document.createElement('div');
        this.optionsList.className = 'custom-options';

        // Populate Options
        this.renderOptions();

        // Assemble
        this.customSelect.appendChild(this.selectedDisplay);
        this.customSelect.appendChild(this.optionsList);

        // Insert after original select
        this.selectElement.parentNode.insertBefore(this.customSelect, this.selectElement.nextSibling);

        // Global Click to Close
        document.addEventListener('click', (e) => {
            if (!this.customSelect.contains(e.target)) {
                this.close();
            }
        });

        // Listen for external changes to the original select (value)
        this.selectElement.addEventListener('change', (e) => {
            this.updateFromOriginal();
        });

        // Observe changes to options (text, adding/removing)
        this.observer = new MutationObserver((mutations) => {
            // Re-render if options change
            this.renderOptions();
            this.updateFromOriginal();
        });

        this.observer.observe(this.selectElement, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true
        });
    }

    renderOptions() {
        this.optionsList.innerHTML = '';
        Array.from(this.selectElement.options).forEach(option => {
            const item = document.createElement('div');
            item.className = 'custom-option';
            item.textContent = option.text;
            item.dataset.value = option.value;

            // Validate if data-i18n is needed for re-translation by external scripts
            // If the original option has data-i18n, we copy it so i18n scripts might pick it up?
            // Actually, usually i18n scripts target elements by attribute.
            // If we copy data-i18n, existing i18n script might translate our custom option too!
            if (option.hasAttribute('data-i18n')) {
                item.setAttribute('data-i18n', option.getAttribute('data-i18n'));
            }

            if (option.selected) {
                item.classList.add('selected');
                this.selectedDisplay.querySelector('.custom-trigger-text').textContent = option.text;
            }

            item.addEventListener('click', (e) => {
                e.stopPropagation();
                this.select(option.value, option.text);
            });

            this.optionsList.appendChild(item);
        });

        // If nothing selected, pick first (display only)
        const currentText = this.selectedDisplay.querySelector('.custom-trigger-text').textContent;
        if (!currentText && this.selectElement.options.length > 0) {
            this.selectedDisplay.querySelector('.custom-trigger-text').textContent = this.selectElement.options[0].text;
        }
    }

    updateFromOriginal() {
        const val = this.selectElement.value;
        const opts = Array.from(this.selectElement.options);
        const matched = opts.find(o => o.value === val);
        if (matched) {
            this.selectedDisplay.querySelector('.custom-trigger-text').textContent = matched.text;
            // Update active class in list
            Array.from(this.optionsList.children).forEach(child => {
                if (child.dataset.value === val) child.classList.add('selected');
                else child.classList.remove('selected');
            });
        }
    }

    toggle() {
        if (this.isOpen) this.close();
        else this.open();
    }

    open() {
        // Close all others first
        document.querySelectorAll('.custom-select-container').forEach(el => el.classList.remove('open'));

        this.customSelect.classList.add('open');
        this.isOpen = true;
    }

    close() {
        this.customSelect.classList.remove('open');
        this.isOpen = false;
    }

    select(value, text) {
        // Update Internal Value
        this.selectElement.value = value;

        // Update UI
        this.selectedDisplay.querySelector('.custom-trigger-text').textContent = text;

        // Visual selection state
        Array.from(this.optionsList.children).forEach(child => {
            if (child.dataset.value === value) child.classList.add('selected');
            else child.classList.remove('selected');
        });

        this.close();

        // Trigger Native Change Event
        const event = new Event('change', { bubbles: true });
        this.selectElement.dispatchEvent(event);
    }
}

// Auto-Init all selects on page load
window.addEventListener('DOMContentLoaded', () => {
    // Initial Init
    initCustomSelects();

    // Also optional: Listen for new selects added to DOM? 
    // For now, manual init is enough for settings.html static content.
});

function initCustomSelects() {
    document.querySelectorAll('select').forEach(el => {
        // Skip if already initialized or explicitly excluded
        if (!el.dataset.customSelectInitialized && !el.classList.contains('no-custom-select')) {
            new CustomSelect(el);
            el.dataset.customSelectInitialized = 'true';
        }
    });
}
