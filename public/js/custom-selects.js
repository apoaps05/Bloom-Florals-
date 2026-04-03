(function () {
  const controllers = new WeakMap();
  const controllerList = new Set();
  let activeController = null;
  let syncIntervalId = null;

  const chevronSvg = [
    '<svg viewBox="0 0 14 14" focusable="false" aria-hidden="true">',
    '<path d="M3 5.25L7 9.25L11 5.25"></path>',
    "</svg>",
  ].join("");

  class CustomSelectController {
    constructor(select) {
      this.select = select;
      this.lastSignature = "";
      this.observer = null;

      this.wrapper = document.createElement("div");
      this.wrapper.className = "custom-select";
      select.classList.forEach((className) => {
        if (className !== "custom-select__native") {
          this.wrapper.classList.add(className);
        }
      });

      this.trigger = document.createElement("button");
      this.trigger.type = "button";
      this.trigger.className = "custom-select__trigger";
      this.trigger.setAttribute("aria-haspopup", "listbox");
      this.trigger.setAttribute("aria-expanded", "false");
      this.trigger.setAttribute(
        "aria-label",
        select.getAttribute("aria-label") || select.getAttribute("name") || "Choose option"
      );
      this.trigger.innerHTML = [
        '<span class="custom-select__value"></span>',
        `<span class="custom-select__icon">${chevronSvg}</span>`,
      ].join("");

      this.menu = document.createElement("div");
      this.menu.className = "custom-select__menu";
      this.menu.setAttribute("role", "listbox");
      this.menu.hidden = true;

      if (select.id) {
        this.menu.id = `${select.id}CustomMenu`;
        this.trigger.setAttribute("aria-controls", this.menu.id);
      }

      const parent = select.parentNode;
      parent.insertBefore(this.wrapper, select);
      this.wrapper.append(select, this.trigger, this.menu);
      this.select.classList.add("custom-select__native");

      this.bindEvents();
      this.observeSelect();
      this.rebuildOptions();
    }

    bindEvents() {
      this.trigger.addEventListener("click", () => this.toggle());
      this.trigger.addEventListener("keydown", (event) => this.handleTriggerKeydown(event));
      this.menu.addEventListener("keydown", (event) => this.handleMenuKeydown(event));
      this.menu.addEventListener("click", (event) => {
        const option = event.target.closest(".custom-select__option");
        if (!option || option.classList.contains("is-disabled")) return;
        this.commitSelection(option.dataset.optionIndex);
      });

      this.select.addEventListener("change", () => this.syncFromSelect());
      this.select.addEventListener("input", () => this.syncFromSelect());
      this.select.addEventListener("invalid", () => this.wrapper.classList.add("is-invalid"));
    }

    observeSelect() {
      this.observer = new MutationObserver(() => this.checkForUpdates());
      this.observer.observe(this.select, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["disabled", "required"],
      });
    }

    buildSignature() {
      const optionSignature = Array.from(this.select.options)
        .map((option, index) => [
          index,
          option.value,
          option.textContent.trim(),
          option.disabled ? 1 : 0,
          option.hidden ? 1 : 0,
        ].join("::"))
        .join("||");

      return [
        this.select.selectedIndex,
        this.select.value,
        this.select.disabled ? 1 : 0,
        this.select.required ? 1 : 0,
        optionSignature,
      ].join("###");
    }

    checkForUpdates() {
      const signature = this.buildSignature();
      if (signature === this.lastSignature) return;
      this.rebuildOptions(signature);
    }

    rebuildOptions(signature = this.buildSignature()) {
      const fragment = document.createDocumentFragment();

      Array.from(this.select.options).forEach((option, optionIndex) => {
        if (option.hidden) return;

        const optionButton = document.createElement("button");
        optionButton.type = "button";
        optionButton.className = "custom-select__option";
        optionButton.dataset.optionIndex = String(optionIndex);
        optionButton.setAttribute("role", "option");
        optionButton.textContent = option.textContent.trim();

        if (option.disabled) {
          optionButton.disabled = true;
          optionButton.classList.add("is-disabled");
        }

        fragment.appendChild(optionButton);
      });

      this.menu.innerHTML = "";
      this.menu.appendChild(fragment);
      this.lastSignature = signature;
      this.syncFromSelect();
    }

    syncFromSelect() {
      const selectedOption = this.select.options[this.select.selectedIndex] || this.select.options[0];
      const valueEl = this.trigger.querySelector(".custom-select__value");
      const selectedText = selectedOption ? selectedOption.textContent.trim() : "";
      const isPlaceholder =
        !this.select.value &&
        selectedOption &&
        selectedOption.value === "" &&
        (selectedOption.disabled || this.select.required);

      valueEl.textContent = selectedText || "Choose option";
      this.wrapper.classList.toggle("is-disabled", this.select.disabled);
      this.wrapper.classList.toggle("is-placeholder", Boolean(isPlaceholder));
      this.wrapper.classList.remove("is-invalid");
      this.trigger.disabled = this.select.disabled;

      Array.from(this.menu.children).forEach((optionButton) => {
        const matchesSelection = Number(optionButton.dataset.optionIndex) === this.select.selectedIndex;
        optionButton.classList.toggle("is-selected", matchesSelection);
        optionButton.setAttribute("aria-selected", matchesSelection ? "true" : "false");
      });
    }

    toggle() {
      if (this.select.disabled) return;
      if (this.wrapper.classList.contains("is-open")) {
        this.close({ restoreFocus: false });
        return;
      }
      this.open();
    }

    open() {
      if (this.select.disabled) return;
      if (activeController && activeController !== this) {
        activeController.close({ restoreFocus: false });
      }

      activeController = this;
      this.wrapper.classList.add("is-open");
      this.trigger.setAttribute("aria-expanded", "true");
      this.menu.hidden = false;
      this.positionMenu();
    }

    close({ restoreFocus = false } = {}) {
      this.wrapper.classList.remove("is-open", "open-up");
      this.trigger.setAttribute("aria-expanded", "false");
      this.menu.hidden = true;

      if (activeController === this) {
        activeController = null;
      }

      if (restoreFocus) {
        this.trigger.focus();
      }
    }

    positionMenu() {
      requestAnimationFrame(() => {
        if (!this.wrapper.classList.contains("is-open")) return;
        const wrapperRect = this.wrapper.getBoundingClientRect();
        const menuHeight = Math.min(this.menu.scrollHeight || 0, 320);
        const shouldOpenUp =
          wrapperRect.bottom + menuHeight > window.innerHeight - 16 &&
          wrapperRect.top > menuHeight + 16;
        this.wrapper.classList.toggle("open-up", shouldOpenUp);
      });
    }

    commitSelection(optionIndex) {
      const numericIndex = Number(optionIndex);
      if (!Number.isInteger(numericIndex)) return;

      const changed = this.select.selectedIndex !== numericIndex;
      this.select.selectedIndex = numericIndex;
      this.select.dispatchEvent(new Event("input", { bubbles: true }));
      if (changed) {
        this.select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      this.syncFromSelect();
      this.close({ restoreFocus: true });
    }

    getEnabledOptions() {
      return Array.from(this.menu.querySelectorAll(".custom-select__option:not(.is-disabled)"));
    }

    focusOption(targetIndex) {
      const enabledOptions = this.getEnabledOptions();
      if (!enabledOptions.length) return;
      const safeIndex = Math.max(0, Math.min(targetIndex, enabledOptions.length - 1));
      enabledOptions[safeIndex].focus();
    }

    focusSelectedOption() {
      const enabledOptions = this.getEnabledOptions();
      if (!enabledOptions.length) return;

      const selectedIndex = enabledOptions.findIndex((option) => option.classList.contains("is-selected"));
      this.focusOption(selectedIndex >= 0 ? selectedIndex : 0);
    }

    handleTriggerKeydown(event) {
      if (this.select.disabled) return;

      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.toggle();
        if (this.wrapper.classList.contains("is-open")) {
          this.focusSelectedOption();
        }
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (!this.wrapper.classList.contains("is-open")) {
          this.open();
        }
        this.focusSelectedOption();
      }
    }

    handleMenuKeydown(event) {
      const enabledOptions = this.getEnabledOptions();
      if (!enabledOptions.length) return;

      const currentIndex = enabledOptions.indexOf(document.activeElement);

      if (event.key === "Escape") {
        event.preventDefault();
        this.close({ restoreFocus: true });
        return;
      }

      if (event.key === "Tab") {
        this.close({ restoreFocus: false });
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        this.focusOption(currentIndex < 0 ? 0 : currentIndex + 1);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        this.focusOption(currentIndex <= 0 ? 0 : currentIndex - 1);
        return;
      }

      if (event.key === "Home") {
        event.preventDefault();
        this.focusOption(0);
        return;
      }

      if (event.key === "End") {
        event.preventDefault();
        this.focusOption(enabledOptions.length - 1);
        return;
      }

      if (event.key === "Enter" || event.key === " ") {
        const focusedOption = document.activeElement.closest(".custom-select__option");
        if (!focusedOption || focusedOption.classList.contains("is-disabled")) return;
        event.preventDefault();
        this.commitSelection(focusedOption.dataset.optionIndex);
      }
    }
  }

  function shouldEnhance(select) {
    if (!select) return false;
    if (controllers.has(select)) return false;
    if (select.multiple || select.size > 1) return false;
    if (select.dataset.nativeSelect === "true") return false;
    if (select.closest(".calendar-month-controls")) return false;
    if (select.classList.contains("custom-select__native")) return false;
    return true;
  }

  function enhanceSelect(select) {
    if (!shouldEnhance(select)) return;
    const controller = new CustomSelectController(select);
    controllers.set(select, controller);
    controllerList.add(controller);
  }

  function initCustomSelects(root) {
    const selects = root.matches && root.matches("select")
      ? [root]
      : Array.from(root.querySelectorAll ? root.querySelectorAll("select") : []);

    selects.forEach((select) => enhanceSelect(select));
  }

  document.addEventListener("click", (event) => {
    if (activeController && !activeController.wrapper.contains(event.target)) {
      activeController.close({ restoreFocus: false });
    }
  });

  window.addEventListener("resize", () => {
    if (activeController) activeController.positionMenu();
  });

  window.addEventListener(
    "scroll",
    () => {
      if (activeController) activeController.positionMenu();
    },
    true
  );

  document.addEventListener("DOMContentLoaded", () => {
    initCustomSelects(document);

    const pageObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          initCustomSelects(node);
        });
      });
    });

    if (document.body) {
      pageObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }

    if (!syncIntervalId) {
      syncIntervalId = window.setInterval(() => {
        controllerList.forEach((controller) => controller.checkForUpdates());
      }, 180);
    }

    window.refreshCustomSelects = () => {
      initCustomSelects(document);
      controllerList.forEach((controller) => controller.checkForUpdates());
    };
  });
})();
