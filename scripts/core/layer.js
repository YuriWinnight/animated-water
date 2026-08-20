export class AnimatedWaterLayer extends InteractionLayer {
  static get layerOptions() {
    return foundry.utils.mergeObject(super.layerOptions, {
      name: "pf1eAnimatedWater",
      zIndex: 250
    });
  }

  async _draw() {
    await super._draw();
  }

  activate({ tool = "select", interaction = false } = {}) {
    if (interaction) return super.activate({ tool });
    const controls = ui.controls;
    const initialize = controls?.initialize;
    if (controls && initialize) controls.initialize = () => {};
    try {
      canvas.tokens?.activate({ tool: "select" });
    } finally {
      if (controls && initialize) controls.initialize = initialize;
    }
    initialize?.call(controls, { layer: this.constructor.layerOptions.name, tool: "select" });
    return this;
  }

  _activate() {
    super._activate();
    this._lastRawWaterClick = null;
    this._waterPointerListener ??= (event) => this._onWaterPointerDown(event);
    this._waterHoverListener ??= (event) => {
      const point = event.getLocalPosition(canvas.stage);
      const interaction = window.PF1EAnimatedWater?.interaction;
      if (interaction?.draggedVertex) interaction.handleDragMove(point);
      else interaction?.handleHover(point);
    };
    this._waterPointerUpListener ??= (event) => {
      const interaction = window.PF1EAnimatedWater?.interaction;
      if (!interaction?.draggedVertex) return;
      const point = event?.getLocalPosition?.(canvas.stage) ?? interaction.hoverPoint;
      if (point) interaction.handleDragDrop(point);
      else interaction.handleDragCancel();
    };
    canvas.stage.on("pointerdown", this._waterPointerListener);
    canvas.stage.on("mousemove", this._waterHoverListener);
    canvas.stage.on("pointerup", this._waterPointerUpListener);
    canvas.stage.on("pointerupoutside", this._waterPointerUpListener);
  }

  _deactivate() {
    if (this._waterPointerListener) canvas.stage.off("pointerdown", this._waterPointerListener);
    if (this._waterHoverListener) canvas.stage.off("mousemove", this._waterHoverListener);
    if (this._waterPointerUpListener) canvas.stage.off("pointerup", this._waterPointerUpListener);
    if (this._waterPointerUpListener) canvas.stage.off("pointerupoutside", this._waterPointerUpListener);
    this._lastRawWaterClick = null;
    this._finishingWaterPolygon = false;
    window.PF1EAnimatedWater?.interaction?.cancel();
    return super._deactivate();
  }

  _onWaterPointerDown(event) {
    if (event.button !== 0 || this._finishingWaterPolygon) return;
    const interaction = window.PF1EAnimatedWater?.interaction;
    if (!interaction?.mode) {
      this._lastRawWaterClick = null;
      return;
    }
    const point = event.getLocalPosition(canvas.stage);
    if (interaction.mode === "edit" && interaction.handleDragStart(point)) {
      this._lastRawWaterClick = null;
      return;
    }
    const now = performance.now();
    const previous = this._lastRawWaterClick;
    const scale = canvas.stage?.scale?.x || 1;
    const isOwnDoubleClick = previous
      && (now - previous.time) <= 300
      && Math.hypot(point.x - previous.x, point.y - previous.y) <= (8 / scale);
    this._lastRawWaterClick = { x: point.x, y: point.y, time: now };
    const canFinishPolygon = interaction?.mode === "draw" && interaction.points.length >= 3;
    if (isOwnDoubleClick && canFinishPolygon) {
      this._finishingWaterPolygon = true;
      Promise.resolve(interaction.handleCanvasDoubleClick(point))
        .finally(() => { this._finishingWaterPolygon = false; });
    } else interaction.handleCanvasClick(point);
  }

  // События Foundry намеренно не используются: в V11 любой второй быстрый клик
  // считается двойным независимо от расстояния между точками.
  _onClickLeft() {}

  _onClickLeft2() {}

  _onMouseMove(event) {
    const point = event.interactionData?.destination ?? event.interactionData?.origin;
    if (point) window.PF1EAnimatedWater?.interaction?.handleHover(point);
  }

  _onDragLeftStart(event) {
    if (window.PF1EAnimatedWater?.interaction?.draggedVertex) return;
    const point = event.interactionData?.origin;
    if (point) window.PF1EAnimatedWater?.interaction?.handleDragStart(point);
  }

  _onDragLeftMove(event) {
    const point = event.interactionData?.destination;
    if (point) window.PF1EAnimatedWater?.interaction?.handleDragMove(point);
  }

  _onDragLeftDrop(event) {
    const point = event.interactionData?.destination;
    if (point) window.PF1EAnimatedWater?.interaction?.handleDragDrop(point);
  }

  _onDragLeftCancel() {
    window.PF1EAnimatedWater?.interaction?.handleDragCancel();
  }

  _onClickRight() {
    window.PF1EAnimatedWater?.interaction?.cancel({ returnToTokens: true });
  }
}

export class AnimatedWaterEffectsLayer extends CanvasLayer {
  // Между обычными тайлами (0) и рисунками/токенами (500/750) PrimaryCanvasGroup.
  static PRIMARY_SORT_ORDER = 400;

  static get layerOptions() {
    return foundry.utils.mergeObject(super.layerOptions, {
      name: "pf1eAnimatedWaterEffects",
      zIndex: 100
    });
  }

  async _draw() {
    this.eventMode = "none";
    this.interactiveChildren = false;
    if (this.parent) {
      this.parent.sortDirty = true;
      this.parent.sortChildren();
    }
  }

  async _tearDown() {
    window.PF1EAnimatedWater?.renderer?.destroy();
  }
}

export class AnimatedWaterSubmersionLayer extends CanvasLayer {
  // Интерфейсная группа гарантированно находится над PrimaryCanvasGroup с токенами.

  static get layerOptions() {
    return foundry.utils.mergeObject(super.layerOptions, {
      name: "pf1eAnimatedWaterSubmersion",
      zIndex: 110
    });
  }

  async _draw() {
    this.zIndex = 110;
    this.eventMode = "none";
    this.interactiveChildren = false;
    if (this.parent) {
      this.parent.sortDirty = true;
      this.parent.sortChildren();
    }
  }
}
