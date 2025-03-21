import { RenderingCancelledException } from "pdfjs-dist";
import { PDFPageProxy, RenderParameters } from "pdfjs-dist/types/src/display/api";
import { PageViewport } from "pdfjs-dist/types/src/display/display_utils";

import { Vec2 } from "mathador";

import { PageInfo } from "../common/page";
import { ModeService, ViewerMode } from "../services/mode-service";

import { PageTextView } from "./page-text-view";
import { PageAnnotationView } from "./page-annotation-view";
import { DocManagerService } from "../services/doc-manager-service";
import { PageComparisonView } from "./page-comparison-view";

export class PageView implements PageInfo { 
  static readonly validRotationValues = [0, 90, 180, 270];

  /**index of the page in the pdf file */
  readonly index: number;
  /**number of the page in the pdf file */
  readonly number: number;
  /**pdf object id of the page */
  readonly id: number;
  /**pdf object generation of the page */
  readonly generation: number;
  
  private readonly _modeService: ModeService;

  private readonly _docManagerService: DocManagerService;
  private readonly _pageProxy: PDFPageProxy;

  private readonly _defaultViewport: PageViewport;
  private _currentViewport: PageViewport;  

  private _dimensions: {
    width: number; 
    height: number;
    previewWidth: number;
    previewHeight: number;
    scaledWidth?: number;
    scaledHeight?: number;
    scaledDprWidth?: number;
    scaledDprHeight?: number;
  };

  private _previewContainer: HTMLDivElement; 
  get previewContainer(): HTMLDivElement {
    return this._previewContainer;
  }
  private _previewRendered: boolean;

  private _viewOuterContainer: HTMLDivElement; 
  get viewContainer(): HTMLDivElement {
    return this._viewOuterContainer;
  }
  private _viewInnerContainer: HTMLDivElement; 
  private _viewCanvas: HTMLCanvasElement; 
  private $viewRendered: boolean;
  private set _viewRendered(value: boolean) {
    this.$viewRendered = value;
    this._viewOuterContainer.setAttribute("data-loaded", value + "");
  }  
  private get _viewRendered(): boolean {
    return this.$viewRendered;
  }

  private _text: PageTextView;
  private _annotations: PageAnnotationView;
  private _comparison: PageComparisonView;

  private _renderTask: {cancel: () => void; promise: Promise<void>};
  private _renderPromise: Promise<void>;

  private _rotation = 0;
  get rotation(): number {
    return this._rotation;
  }
  set rotation(value: number) {   
    if (!PageView.validRotationValues.includes(value) 
      || this._rotation === value) {
      return;
    }
    this._rotation = value;
    this.refreshDimensions();
  }
  
  private _scale = 1; 
  get scale(): number {
    return this._scale;
  }
  set scale(value: number) {   
    if (value <= 0 || this._scale === value) {
      return;
    }
    this._scale = value;
    this.refreshDimensions();
  }

  get width(): number {
    return this._dimensions.width;
  }
  get height(): number {
    return this._dimensions.height;
  }

  private _dimensionsIsValid: boolean;
  private _lastRenderMode: ViewerMode;
  /**returns 'true' if the current mode is same as it was during last render */
  get modeNotChanged(): boolean {
    return this._lastRenderMode === this._modeService.mode;
  }
  /**returns 'true' if the view is rendered using the current scale */
  get viewValid(): boolean {
    return this._dimensionsIsValid && this._viewRendered;
  }

  private _destroyed: boolean;

  constructor(modeService: ModeService, docManagerService: DocManagerService, 
    pageIndex: number, previewWidth: number) {
    if (!modeService) {
      throw new Error("Mode service is not defined");
    }
    if (!docManagerService) {
      throw new Error("Loader service is not defined");
    }
    
    this._modeService = modeService;
    this._docManagerService = docManagerService;

    const pageProxy = docManagerService.getPageProxy("main", pageIndex);
    if (!pageProxy) {
      throw new Error("Page proxy is not defined");
    }
    this._pageProxy = pageProxy;
    
    this._defaultViewport = pageProxy.getViewport({scale: 1, rotation: 0});
    this._rotation = pageProxy.rotate;

    this.index = pageIndex;
    this.number = pageProxy.pageNumber;
    this.id = pageProxy.ref["num"];
    this.generation = pageProxy.ref["gen"];

    this.initDom(previewWidth);
  }

  /**free the resources that can prevent garbage to be collected */
  destroy() {
    this._destroyed = true;
    this._previewContainer.remove();
    this._viewOuterContainer.remove();
    this._pageProxy.cleanup();
  }

  /**
   * render the preview to the SVG element and append in to the preview container
   * @param force rerender an already rendered preview even if it's up to date
   * @returns 
   */
  async renderPreviewAsync(force = false): Promise<void> { 
    if (this._renderPromise) {
      if (force) {
        this.cancelRenderTask();
      }
      await this._renderPromise;
    }
    
    if (!force && this._previewRendered) {
      return;
    }

    this._renderPromise = this.runPreviewRenderAsync();
    return this._renderPromise;
  }
  
  /**
   * render the view to the SVG element and append in to the view container
   * @param force rerender an already rendered view even if it's up to date
   * @returns 
   */
  async renderViewAsync(force = false): Promise<void> { 
    if (this._renderPromise) {
      if (force) {
        this.cancelRenderTask();
      }
      await this._renderPromise;
    }

    if (!force && this.viewValid && this.modeNotChanged) {
      return;
    }

    this._renderPromise = this.runViewRenderAsync(force);
    return this._renderPromise;
  }
  
  /**clear the preview container */
  clearPreview() {
    this._previewContainer.innerHTML = "";
  }

  /**clear the view container */
  clearView() {
    this._comparison?.destroy();
    this._comparison = null;

    this._annotations?.destroy();
    this._annotations = null;

    this._text?.destroy();
    this._text = null;
    
    this._viewCanvas?.remove();
    this._viewRendered = false;
  }
  
  rotateClockwise() {
    if (!this._rotation) {
      this.rotation = 270;
    } else {
      this.rotation = this._rotation - 90;
    }
  }

  rotateCounterClockwise() {
    if (this._rotation === 270) {
      this.rotation = 0;
    } else {
      this.rotation = (this._rotation || 0) + 90;
    }
  }

  private initDom(previewWidth: number) {
    const {width, height} = this._defaultViewport;
    previewWidth = Math.max(previewWidth ?? 0, 50);
    const previewHeight = previewWidth * (height / width);
    this._dimensions = {width, height, previewWidth, previewHeight};

    this._previewContainer = document.createElement("div");
    this._previewContainer.classList.add("page-preview");    
    this._previewContainer.setAttribute("data-page-number", this.number + "");
    this._previewContainer.setAttribute("data-page-id", this.id + "");
    this._previewContainer.setAttribute("data-page-gen", this.generation + "");
    this._previewContainer.style.width = this._dimensions.previewWidth + "px";
    this._previewContainer.style.height = this._dimensions.previewHeight + "px";    

    this._viewOuterContainer = document.createElement("div");
    this._viewOuterContainer.classList.add("page-container");
    this._viewOuterContainer.setAttribute("data-page-number", this.number + ""); 
    this._viewOuterContainer.setAttribute("data-page-id", this.id + "");
    this._viewOuterContainer.setAttribute("data-page-gen", this.generation + "");  

    this._viewInnerContainer = document.createElement("div");
    this._viewInnerContainer.classList.add("page");
    this._viewInnerContainer.setAttribute("data-page-number", this.number + ""); 
    this._viewInnerContainer.setAttribute("data-page-id", this.id + "");
    this._viewInnerContainer.setAttribute("data-page-gen", this.generation + "");
    this._viewOuterContainer.append(this._viewInnerContainer);

    this.refreshDimensions();
  }

  private refreshDimensions() {
    const dpr = window.devicePixelRatio;
    this._currentViewport = this._defaultViewport.clone({
      scale: this.scale * dpr,
    });
    
    this._dimensions.scaledWidth = this._dimensions.width * this._scale;
    this._dimensions.scaledHeight = this._dimensions.height * this._scale;
    this._dimensions.scaledDprWidth = this._dimensions.scaledWidth * dpr;
    this._dimensions.scaledDprHeight = this._dimensions.scaledHeight * dpr;

    const w = this._dimensions.scaledWidth + "px";
    const h = this._dimensions.scaledHeight + "px";
    
    if (this._viewCanvas) {
      this._viewCanvas.style.width = w;
      this._viewCanvas.style.height = h;
    }

    this._viewInnerContainer.style.width = w;
    this._viewInnerContainer.style.height = h;

    switch (this.rotation) {
      case 0: 
        this._viewOuterContainer.style.width = w;
        this._viewOuterContainer.style.height = h;       
        this._viewInnerContainer.style.transform = "";
        break;
      case 90:        
        this._viewOuterContainer.style.width = h;
        this._viewOuterContainer.style.height = w;    
        this._viewInnerContainer.style.transform = "rotate(90deg) translateY(-100%)";
        break;
      case 180:
        this._viewOuterContainer.style.width = w;
        this._viewOuterContainer.style.height = h; 
        this._viewInnerContainer.style.transform = "rotate(180deg) translateX(-100%) translateY(-100%)";
        break;
      case 270:
        this._viewOuterContainer.style.width = h;
        this._viewOuterContainer.style.height = w; 
        this._viewInnerContainer.style.transform = "rotate(270deg) translateX(-100%)";
        break;
      default:
        throw new Error(`Invalid rotation degree: ${this.rotation}`);
    }

    this._dimensionsIsValid = false;
  }
 
  private cancelRenderTask() {    
    if (this._renderTask) {
      this._renderTask.cancel();   
      this._renderTask = null;
    }
  }

  private async runRenderTaskAsync(renderParams: RenderParameters): Promise<boolean> {
    if (this._destroyed) {
      return false;
    }
    
    this.cancelRenderTask();
    try {
      this._renderTask = this._pageProxy.render(renderParams);
      await this._renderTask.promise;
    } catch (error) {
      if (error instanceof RenderingCancelledException) {
        return false;
      } else {
        //console.log(error.message);
      }
    } finally {
      this._renderTask = null;
    }

    return true;
  }
  
  private createPreviewCanvas(): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.classList.add("page-canvas");  
    const dpr = window.devicePixelRatio;
    const {previewWidth: width, previewHeight: height} = this._dimensions;  
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    return canvas;
  }

  private createViewCanvas(): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.classList.add("page-canvas"); 
    canvas.style.width = this._dimensions.scaledWidth + "px";
    canvas.style.height = this._dimensions.scaledHeight + "px";
    canvas.width = this._dimensions.scaledDprWidth;
    canvas.height = this._dimensions.scaledDprHeight;
    return canvas;
  }
  
  private async runPreviewRenderAsync(): Promise<void> { 
    if (this._destroyed) {
      return;
    }
    
    const canvas = this.createPreviewCanvas();
    const params = <RenderParameters>{
      canvasContext: canvas.getContext("2d"),
      viewport: this._defaultViewport.clone({scale: canvas.width / this._dimensions.width, rotation: 0}),
    };
    const result = await this.runRenderTaskAsync(params);
    if (!result) {
      this._previewRendered = false;
      return;
    }
    
    this._previewContainer.innerHTML = "";
    this._previewContainer.append(canvas);
    this._previewRendered = true;
  }

  private async runViewRenderAsync(force: boolean): Promise<void> { 
    if (this._destroyed) {
      return;
    }    

    const mode = this._modeService.mode;
    const scale = this._scale;

    // clear page layers
    this.clearTextLayer();

    if (force || !this.viewValid) {
      // render canvas layer
      const canvasRendered = await this.renderCanvasLayerAsync(scale);
      if (!canvasRendered) {
        return;
      }
    }

    if (mode === "text"
     || mode === "annotation") {
      // add text layer on top of the canvas layer
      await this.renderTextLayerAsync(scale);
    }

    if (mode !== "comparison") {
      // add annotations layer on top of the canvas/text layer
      await this.renderAnnotationLayerAsync();
    } else {
      this._annotations?.remove();
      // add comparison layer on top of the canvas layer
      await this.renderComparisonLayerAsync();
    }

    this._lastRenderMode = mode;
    // check if scale not changed during render
    if (scale === this._scale) {
      this._dimensionsIsValid = true;
    }
  }

  private clearTextLayer() {
    this._text?.destroy();
    this._text?.remove();
  }

  private async renderCanvasLayerAsync(scale: number): Promise<boolean> {
    // create a new canvas of the needed size and fill it with a rendered page
    const canvas = this.createViewCanvas();
    const params = <RenderParameters>{
      canvasContext: canvas.getContext("2d"),
      viewport: this._currentViewport,
      enableWebGL: true,
    };
    const result = await this.runRenderTaskAsync(params);
    if (!result || scale !== this._scale) {
      // page rendering was cancelled  
      // or scale changed during rendering    
      return false;
    }

    this._viewCanvas?.remove();
    this._viewInnerContainer.append(canvas);
    this._viewCanvas = canvas;
    this._viewRendered = true;
    return true;
  }

  private async renderTextLayerAsync(scale: number): Promise<void> {
    this._text = await PageTextView.appendPageTextAsync(
      this._pageProxy, this._viewInnerContainer, scale); 
  }

  private async renderAnnotationLayerAsync(): Promise<void> {
    if (!this._annotations) {
      const {width: x, height: y} = this._dimensions;
      this._annotations = new PageAnnotationView(
        this._docManagerService.docService, this, new Vec2(x, y));
    }
    await this._annotations.appendAsync(this._viewInnerContainer);
  }

  private async renderComparisonLayerAsync(): Promise<void> {
    const comparisonPageProxy = this._docManagerService.getPageProxy("compared", this.index);
    if (!comparisonPageProxy) {
      this._comparison?.remove();
      return;
    }

    if (!this._comparison) {
      const {width: x, height: y} = this._dimensions;
      this._comparison = new PageComparisonView(
        this._docManagerService.comparisonService, this, new Vec2(x, y));
    }
    await this._comparison.appendAsync(this._viewInnerContainer, comparisonPageProxy, this._scale);
  }
}
