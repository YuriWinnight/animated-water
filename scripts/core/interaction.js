import { MODULE_ID, SOURCE_TYPES } from "../constants.js";
import { WaterDetector } from "./detector.js";
import { WaterStore } from "./store.js";

export class WaterInteractionController {
  constructor() {
    this.mode = null;
    this.points = [];
    this.editArea = null;
    this.draggedVertex = null;
    this.hoveredVertex = null;
    this.hoverPoint = null;
    this.preview = null;
    this.view = null;
    this.busy = false;
    this.operationVersion = 0;
    this.history = [];
    this.dragHistoryRecorded = false;
    this.dragStartPoint = null;
    this.dragMoved = false;
    this._onKeyDown = this._onKeyDown.bind(this);
  }

  startDraw() {
    this._start("draw");
  }

  startDetect() {
    this._start("detect");
  }

  startEdit(area) {
    this._start("edit");
    this.editArea = foundry.utils.deepClone(area);
    this._drawPreview();
  }

  _start(mode) {
    this.cancel();
    if (!canvas?.ready || !game.user?.isGM) return;
    if (canvas.activeLayer !== canvas.pf1eAnimatedWater) {
      canvas.pf1eAnimatedWater?.activate({ tool: mode, interaction: true });
    }
    this.mode = mode;
    this.view = canvas.app.view;
    this.view.classList.add("pf1e-aw-crosshair");
    window.addEventListener("keydown", this._onKeyDown, true);
    if (mode !== "submerge") this._ensurePreview();
  }

  cancel({ returnToTokens = false } = {}) {
    const previewAreaId = this.mode === "edit" ? this.editArea?.id : null;
    this.operationVersion += 1;
    this.view?.classList.remove("pf1e-aw-crosshair", "pf1e-aw-busy");
    window.removeEventListener("keydown", this._onKeyDown, true);
    this.preview?.parent?.removeChild(this.preview);
    this.preview?.destroy();
    this.preview = null;
    this.view = null;
    this.mode = null;
    this.points = [];
    this.editArea = null;
    this.draggedVertex = null;
    this.hoveredVertex = null;
    this.hoverPoint = null;
    this.busy = false;
    this.history = [];
    this.dragHistoryRecorded = false;
    this.dragStartPoint = null;
    this.dragMoved = false;
    if (previewAreaId) window.PF1EAnimatedWater?.renderer?.clearAreaPreview?.(previewAreaId);
    if (returnToTokens && canvas?.ready && canvas.activeLayer === canvas.pf1eAnimatedWater) {
      canvas.pf1eAnimatedWater.activate();
    }
  }

  _ensurePreview() {
    this.preview = new PIXI.Graphics();
    this.preview.name = `${MODULE_ID}-preview`;
    canvas.interface.addChild(this.preview);
  }

  async handleCanvasClick(point) {
    if (this.busy) return;
    if (this.mode === "draw") {
      this._recordHistory();
      this.points.push([point.x, point.y]);
      this._drawPreview();
      return;
    }
    if (this.mode === "detect") {
      await this._detect(point);
      return;
    }
    if (this.mode === "edit") {
      const vertex = this._nearestVertex(point);
      if (vertex) return;
      const onlyPolygon = this.editArea.geometry.polygons.length === 1
        ? this.editArea.geometry.polygons[0]
        : null;
      if (onlyPolygon && onlyPolygon.outer.length < 3 && !(onlyPolygon.holes ?? []).length) {
        this._recordHistory();
        onlyPolygon.outer.push([point.x, point.y]);
        this.hoveredVertex = {
          polygonIndex: 0,
          ring: "outer",
          ringIndex: -1,
          pointIndex: onlyPolygon.outer.length - 1
        };
        this._drawPreview();
        this._previewEditedGeometry();
        this._renderManager();
        return;
      }
      const segment = this._nearestSegment(point);
      if (!segment) return;
      const polygon = this.editArea.geometry.polygons[segment.polygonIndex];
      const points = segment.ring === "outer" ? polygon.outer : polygon.holes[segment.ringIndex];
      this._recordHistory();
      points.splice(segment.insertIndex, 0, [segment.point.x, segment.point.y]);
      this.hoveredVertex = {
        polygonIndex: segment.polygonIndex,
        ring: segment.ring,
        ringIndex: segment.ringIndex,
        pointIndex: segment.insertIndex
      };
      this._drawPreview();
      this._previewEditedGeometry();
      this._renderManager();
    }
  }

  async handleCanvasDoubleClick(point) {
    if (this.mode !== "draw") return;
    const scale = canvas.stage.scale.x || 1;
    const last = this.points.at(-1);
    const previous = this.points.at(-2);
    if (last && previous && Math.hypot(last[0] - previous[0], last[1] - previous[1]) <= (12 / scale)) {
      this.points.pop();
    }
    await this._finishDraw();
  }

  handleHover(point) {
    this.hoverPoint = { x: point.x, y: point.y };
    if (this.mode === "edit" && !this.draggedVertex) this.hoveredVertex = this._nearestVertex(point);
    this._drawPreview(this.hoverPoint);
  }

  handleDragStart(point) {
    if (this.mode !== "edit") return false;
    this.draggedVertex = this._nearestVertex(point);
    this.hoveredVertex = this.draggedVertex;
    this.dragHistoryRecorded = false;
    this.dragStartPoint = this.draggedVertex ? { x: point.x, y: point.y } : null;
    this.dragMoved = false;
    return Boolean(this.draggedVertex);
  }

  handleDragMove(point) {
    if (this.mode === "edit" && this.draggedVertex) {
      this.hoverPoint = { x: point.x, y: point.y };
      if (!this.dragMoved && this.dragStartPoint) {
        const scale = canvas.stage.scale.x || 1;
        const distance = Math.hypot(point.x - this.dragStartPoint.x, point.y - this.dragStartPoint.y);
        if (distance < (1 / scale)) return;
      }
      this.dragMoved = true;
      if (!this.dragHistoryRecorded) {
        this._recordHistory();
        this.dragHistoryRecorded = true;
      }
      const { polygonIndex, ring, ringIndex, pointIndex } = this.draggedVertex;
      const polygon = this.editArea.geometry.polygons[polygonIndex];
      const points = ring === "outer" ? polygon.outer : polygon.holes[ringIndex];
      points[pointIndex] = [point.x, point.y];
      this.hoveredVertex = this.draggedVertex;
      this._drawPreview();
    }
  }

  handleDragDrop(point) {
    this.handleDragMove(point);
    const moved = this.dragMoved;
    this.draggedVertex = null;
    this.dragHistoryRecorded = false;
    this.dragStartPoint = null;
    this.dragMoved = false;
    if (moved) this._previewEditedGeometry();
  }

  handleDragCancel() {
    this.draggedVertex = null;
    this.dragHistoryRecorded = false;
    this.dragStartPoint = null;
    this.dragMoved = false;
  }

  async _onKeyDown(event) {
    if (!this.mode) return;
    if (event.key === "Escape") {
      event.preventDefault();
      this.cancel({ returnToTokens: true });
      this._renderManager();
      return;
    }
    const undoKey = event.code === "KeyZ" || ["z", "я"].includes(event.key.toLowerCase());
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && undoKey
      && (this.mode === "draw" || this.mode === "edit")) {
      event.preventDefault();
      event.stopPropagation?.();
      this.undo();
      return;
    }
    if (this.mode === "draw" && event.key === "Backspace") {
      event.preventDefault();
      this.undo();
      return;
    }
    if (this.mode === "edit" && event.key === "Delete") {
      event.preventDefault();
      await this._deleteHoveredVertex();
      return;
    }
  }

  _recordHistory() {
    if (this.mode === "draw") this.history.push({ points: foundry.utils.deepClone(this.points) });
    else if (this.mode === "edit" && this.editArea) {
      this.history.push({ geometry: foundry.utils.deepClone(this.editArea.geometry) });
    }
    if (this.history.length > 100) this.history.shift();
  }

  undo() {
    const previous = this.history.pop();
    if (!previous) return false;
    if (this.mode === "draw" && previous.points) this.points = previous.points;
    else if (this.mode === "edit" && previous.geometry && this.editArea) {
      this.editArea.geometry = previous.geometry;
      this.draggedVertex = null;
      this.hoveredVertex = null;
      this.dragHistoryRecorded = false;
      this.dragStartPoint = null;
      this.dragMoved = false;
    }
    this._drawPreview(this.hoverPoint);
    if (this.mode === "edit") {
      this._previewEditedGeometry();
      this._renderManager();
    }
    return true;
  }

  async saveEdit() {
    if (this.mode !== "edit" || !this.editArea) return false;
    await WaterStore.updateArea(this.editArea.id, { geometry: this.editArea.geometry });
    this.cancel({ returnToTokens: true });
    this._renderManager();
    return true;
  }

  cancelEdit() {
    if (this.mode !== "edit") return false;
    this.cancel({ returnToTokens: true });
    this._renderManager();
    return true;
  }

  _renderManager() {
    const manager = Object.values(ui.windows ?? {}).find((application) =>
      application?.id === "animated-water-manager"
      || application?.options?.id === "animated-water-manager"
    );
    manager?.render(false);
  }

  async _finishDraw() {
    if (!this.points.length) return;
    await WaterStore.addArea({
      name: `Ручная область ${WaterStore.getAreas().length + 1}`,
      source: SOURCE_TYPES.POLYGON,
      geometry: { polygons: [{ outer: this.points, holes: [] }] }
    });
    this.cancel({ returnToTokens: true });
  }

  async _detect(point) {
    if (this.busy) return;
    const view = this.view;
    const operationVersion = ++this.operationVersion;
    this.busy = true;
    view?.classList.add("pf1e-aw-busy");
    try {
      const tolerance = game.settings.get(MODULE_ID, "detectionTolerance");
      const result = await WaterDetector.detect(point, tolerance);
      if (operationVersion !== this.operationVersion) return;
      await WaterStore.addArea({
        name: `Определённая область ${WaterStore.getAreas().length + 1}`,
        source: SOURCE_TYPES.FLOOD_FILL,
        geometry: { polygons: result.polygons }
      });
      this.cancel({ returnToTokens: true });
    } catch (error) {
      if (operationVersion !== this.operationVersion) return;
      console.error(`${MODULE_ID} | Ошибка определения воды`, error);
      ui.notifications.error(error.message);
    } finally {
      view?.classList.remove("pf1e-aw-busy");
      if (operationVersion === this.operationVersion) this.busy = false;
    }
  }

  _nearestVertex(point) {
    const scale = canvas.stage.scale.x || 1;
    const maximum = 14 / scale;
    let nearest = null;
    let nearestDistance = maximum;
    this.editArea.geometry.polygons.forEach((polygon, polygonIndex) => {
      const rings = [{ ring: "outer", ringIndex: -1, points: polygon.outer }]
        .concat((polygon.holes ?? []).map((points, ringIndex) => ({ ring: "hole", ringIndex, points })));
      for (const entry of rings) {
        entry.points.forEach((vertex, pointIndex) => {
          const distance = Math.hypot(vertex[0] - point.x, vertex[1] - point.y);
          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearest = { polygonIndex, ring: entry.ring, ringIndex: entry.ringIndex, pointIndex };
          }
        });
      }
    });
    return nearest;
  }

  _nearestSegment(point) {
    const maximum = 12 / (canvas.stage.scale.x || 1);
    let nearest = null;
    let nearestDistance = maximum;
    this.editArea.geometry.polygons.forEach((polygon, polygonIndex) => {
      const rings = [{ ring: "outer", ringIndex: -1, points: polygon.outer }]
        .concat((polygon.holes ?? []).map((points, ringIndex) => ({ ring: "hole", ringIndex, points })));
      for (const entry of rings) {
        for (let index = 0; index < entry.points.length; index += 1) {
          const start = entry.points[index];
          const end = entry.points[(index + 1) % entry.points.length];
          const dx = end[0] - start[0];
          const dy = end[1] - start[1];
          const lengthSquared = (dx * dx) + (dy * dy);
          const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
            (((point.x - start[0]) * dx) + ((point.y - start[1]) * dy)) / lengthSquared
          ));
          const projected = { x: start[0] + (t * dx), y: start[1] + (t * dy) };
          const distance = Math.hypot(point.x - projected.x, point.y - projected.y);
          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearest = {
              polygonIndex,
              ring: entry.ring,
              ringIndex: entry.ringIndex,
              insertIndex: index + 1,
              point: projected
            };
          }
        }
      }
    });
    return nearest;
  }

  async _deleteHoveredVertex() {
    const vertex = this.hoveredVertex;
    if (!vertex || !this.editArea) return false;
    const polygon = this.editArea.geometry.polygons[vertex.polygonIndex];
    const points = vertex.ring === "outer" ? polygon?.outer : polygon?.holes?.[vertex.ringIndex];
    if (!points?.[vertex.pointIndex]) return false;
    this._recordHistory();
    points.splice(vertex.pointIndex, 1);
    this.hoveredVertex = null;
    this.draggedVertex = null;
    this.dragHistoryRecorded = false;
    this.dragStartPoint = null;
    this.dragMoved = false;

    const remainingPoints = this.editArea.geometry.polygons.reduce((sum, entry) => sum
      + entry.outer.length
      + (entry.holes ?? []).reduce((holeSum, hole) => holeSum + hole.length, 0), 0);
    if (!remainingPoints) {
      const areaId = this.editArea.id;
      this.cancel({ returnToTokens: true });
      await WaterStore.deleteArea(areaId);
      this._renderManager();
      return true;
    }

    this._drawPreview();
    this._previewEditedGeometry();
    this._renderManager();
    return true;
  }

  _previewEditedGeometry() {
    if (this.mode !== "edit" || !this.editArea) return;
    window.PF1EAnimatedWater?.renderer?.previewArea?.(this.editArea.id, {
      geometry: foundry.utils.deepClone(this.editArea.geometry)
    });
  }

  _drawPreview(pointer = null) {
    if (!this.preview) return;
    this.preview.clear();
    const drawRing = (points, closed = true) => {
      if (!points.length) return;
      this.preview.lineStyle(3 / (canvas.stage.scale.x || 1), 0x43cfff, 0.95);
      this.preview.moveTo(points[0][0], points[0][1]);
      points.slice(1).forEach(([x, y]) => this.preview.lineTo(x, y));
      if (closed && points.length >= 3) this.preview.lineTo(points[0][0], points[0][1]);
      const radius = 5 / (canvas.stage.scale.x || 1);
      for (const [x, y] of points) this.preview.beginFill(0xffffff).drawCircle(x, y, radius).endFill();
    };
    if (this.mode === "draw") {
      const previewPoints = pointer ? this.points.concat([[pointer.x, pointer.y]]) : this.points;
      drawRing(previewPoints, false);
    } else if (this.mode === "edit") {
      for (const polygon of this.editArea.geometry.polygons) {
        drawRing(polygon.outer);
        for (const hole of polygon.holes ?? []) drawRing(hole);
      }
      if (this.hoveredVertex) {
        const polygon = this.editArea.geometry.polygons[this.hoveredVertex.polygonIndex];
        const points = this.hoveredVertex.ring === "outer"
          ? polygon.outer
          : polygon.holes[this.hoveredVertex.ringIndex];
        const point = points?.[this.hoveredVertex.pointIndex];
        if (point) {
          const radius = 8 / (canvas.stage.scale.x || 1);
          this.preview.beginFill(0xff4d4d, 1).drawCircle(point[0], point[1], radius).endFill();
        }
      }
    }
  }
}
