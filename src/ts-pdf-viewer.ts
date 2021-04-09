/* eslint-disable @typescript-eslint/no-use-before-define */
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist/types/display/api";

import { html, passwordDialogHtml } from "./assets/index.html";
import { styles } from "./assets/styles.html";

import { getDistance, Quadruple } from "./common";
import { clamp, Vec2 } from "./math";

import { DocumentData } from "./document/document-data";
import { PageView } from "./page/page-view";
import { ContextMenu } from "./helpers/context-menu";
import { Annotator } from "./annotator/annotator";
import { StampAnnotator } from "./annotator/stamp-annotator";
import { PathChangeEvent, PenAnnotator } from "./annotator/pen-annotator";
import { AnnotationDto, AnnotEvent, AnnotEventDetail } from "./annotator/serialization";

type ViewerMode = "text" | "hand" | "annotation";
type AnnotatorMode = "select" | "stamp" | "pen" | "geometric";

type FileButtons = "open" | "save" | "close";

export interface TsPdfViewerOptions {
  /**parent container CSS selector */
  containerSelector: string;
  /**path to the PDF.js worker */
  workerSource: string;
  /**current user name (used for annotations) */
  userName?: string;

  /**list of the file interaction buttons shown*/
  fileButtons?: FileButtons[];
  /**action to execute instead of the default file open action*/
  fileOpenAction?: () => void;
  /**action to execute instead of the default file download action*/
  fileSaveAction?: () => void;
  fileCloseAction?: () => void;

  /**action to execute on annotation change event */
  annotChangeCallback?: (detail: AnnotEventDetail) => void;
}

export {AnnotationDto, AnnotEvent, AnnotEventDetail};

export class TsPdfViewer {
  //#region private fields
  private readonly _userName: string;

  // TODO: move readonly properties to the main options
  /**count of the prerendered pages outside of the current viewer viewport */
  private readonly _visibleAdjPages = 0;
  private readonly _previewWidth = 100;
  private readonly _minScale = 0.25;
  private readonly _maxScale = 4;
  private _scale = 1;

  private _fileOpenAction: () => void;
  private _fileSaveAction: () => void;
  private _fileCloseAction: () => void;
  private _annotChangeCallback: (detail: AnnotEventDetail) => void;

  private _outerContainer: HTMLDivElement;
  private _shadowRoot: ShadowRoot;

  private _mainContainer: HTMLDivElement;
  private _mainContainerRObserver: ResizeObserver;
  private _panelsHidden: boolean;

  private _fileInput: HTMLInputElement;

  private _previewer: HTMLDivElement;
  private _previewerHidden = true;

  private _viewer: HTMLDivElement;
  private _viewerMode: ViewerMode;

  private _pages: PageView[] = [];
  private _renderedPages: PageView[] = [];
  private _currentPage = 0;

  private _pdfLoadingTask: PDFDocumentLoadingTask;
  private _pdfDocument: PDFDocumentProxy;  

  private _docData: DocumentData;
  private _annotatorMode: AnnotatorMode;
  private _annotator: Annotator;

  private _contextMenu: ContextMenu;
  private _contextMenuEnabled: boolean;
  
  /**information about the last pointer position */
  private _pointerInfo = {
    lastPos: <Vec2>null,
    downPos: <Vec2>null,
    downScroll: <Vec2>null, 
  };
  /**common timers */
  private _timers = {    
    hidePanels: 0,
  };
  /**the object used for touch zoom handling */
  private _pinchInfo = {
    active: false,
    lastDist: 0,
    minDist: 10,
    sensitivity: 0.025,
    target: <HTMLElement>null,
  };
  //#endregion


  constructor(options: TsPdfViewerOptions) {
    if (!options) {
      throw new Error("No options provided");
    }

    const container = document.querySelector(options.containerSelector);
    if (!container) {
      throw new Error("Container not found");
    } else if (!(container instanceof HTMLDivElement)) {
      throw new Error("Container is not a DIV element");
    } else {
      this._outerContainer = container;
    }
    
    if (!options.workerSource) {
      throw new Error("Worker source path not defined");
    }
    GlobalWorkerOptions.workerSrc = options.workerSource;

    this._userName = options.userName || "Guest";
    this._fileOpenAction = options.fileOpenAction;
    this._fileSaveAction = options.fileSaveAction;
    this._fileCloseAction = options.fileCloseAction;
    this._annotChangeCallback = options.annotChangeCallback;

    this._shadowRoot = this._outerContainer.attachShadow({mode: "open"});
    this._shadowRoot.innerHTML = styles + html;         

    this.initMainDivs();
    this.initViewControls();
    this.initFileButtons(options.fileButtons || []);
    this.initModeSwitchButtons();
    this.initAnnotationButtons();
    
    // handle annotation selection
    document.addEventListener("tspdf-annotchange", this.onAnnotationChange);
  }

  /**create a temp download link and click on it */
  private static downloadFile(blob: Blob, name?: string) {
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.setAttribute("download", name);
    link.href = url;
    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  /**free resources to let GC clean them to avoid memory leak */
  destroy() {
    document.removeEventListener("tspdf-annotchange", this.onAnnotationChange);
    this._annotChangeCallback = null;

    this._pdfLoadingTask?.destroy();
    this._pages.forEach(x => x.destroy());
    if (this._pdfDocument) {
      this._pdfDocument.cleanup();
      this._pdfDocument.destroy();
    }  
    this._annotator?.destroy();
    this._docData?.destroy();  

    this._contextMenu?.destroy();
    this._mainContainerRObserver?.disconnect();
    this._shadowRoot.innerHTML = "";
  }  
  
  async openPdfAsync(src: string | Blob | Uint8Array): Promise<void> {
    let data: Uint8Array;
    let doc: PDFDocumentProxy;

    // get the plain pdf data as a byte array
    try {
      if (src instanceof Uint8Array) {
        data = src;
      } else {
        let blob: Blob;  
        if (typeof src === "string") {
          const res = await fetch(src);
          blob = await res.blob();
        } else {
          blob = src;
        }  
        const buffer = await blob.arrayBuffer();
        data = new Uint8Array(buffer);
      }
    } catch (e) {
      throw new Error(`Cannot load file data: ${e.message}`);
    }

    // create DocumentData
    const docData = new DocumentData(data, this._userName);
    let password: string;
    while (true) {      
      const authenticated = docData.tryAuthenticate(password);
      if (!authenticated) {        
        password = await this.showPasswordDialogAsync();
        if (password === null) {          
          throw new Error("File loading cancelled: authentication aborted");
        }
        continue;
      }
      break;
    }

    // get the pdf data with the supported annotations cut out
    data = docData.getDataWithoutSupportedAnnotations();

    // try open the data with PDF.js
    try {
      if (this._pdfLoadingTask) {
        await this.closePdfAsync();
        return this.openPdfAsync(data);
      }
  
      this._pdfLoadingTask = getDocument({data, password});
      this._pdfLoadingTask.onProgress = this.onPdfLoadingProgress;
      doc = await this._pdfLoadingTask.promise;    
      this._pdfLoadingTask = null;
    } catch (e) {
      throw new Error(`Cannot open PDF: ${e.message}`);
    }

    // update viewer state
    this._pdfDocument = doc;
    this._docData = docData;
    this.setAnnotationMode("select");  

    await this.refreshPagesAsync();
    this.renderVisiblePreviews();
    this.renderVisiblePages(); 

    this._mainContainer.classList.remove("disabled");
  }

  async closePdfAsync(): Promise<void> {
    if (this._pdfLoadingTask) {
      if (!this._pdfLoadingTask.destroyed) {
        await this._pdfLoadingTask.destroy();
      }
      this._pdfLoadingTask = null;
    }

    // update viewer state
    this._mainContainer.classList.add("disabled");
    this.setViewerMode("text");
    if (this._pdfDocument) {
      this._pdfDocument.destroy();
      this._pdfDocument = null;

      this._annotator?.destroy();
      this._annotator = null;
      
      this._docData?.destroy();
      this._docData = null;
    }
    await this.refreshPagesAsync();
  }
  
  /**
   * import previously exported TsPdf annotations
   * @param dtos annotation data transfer objects
   */
  importAnnotations(dtos: AnnotationDto[]) {
    try {
      this._docData?.appendSerializedAnnotations(dtos);
    } catch (e) {
      console.log(`Error while importing annotations: ${e.message}`);      
    }
  }
  
  /**
   * export TsPdf annotations as data transfer objects
   * @returns 
   */
  exportAnnotations(): AnnotationDto[] {
    const dtos = this._docData?.serializeAnnotations(true);
    return dtos;
  }  
  
  /**
   * import previously exported serialized TsPdf annotations
   * @param json serialized annotation data transfer objects
   */
  importAnnotationsFromJson(json: string) {
    try {
      const dtos: AnnotationDto[] = JSON.parse(json);
      this._docData?.appendSerializedAnnotations(dtos);
    } catch (e) {
      console.log(`Error while importing annotations: ${e.message}`);      
    }
  }
  
  /**
   * export TsPdf annotations as a serialized array of data transfer objects
   * @returns 
   */
  exportAnnotationsToJson(): string {
    const dtos = this._docData?.serializeAnnotations(true);
    return JSON.stringify(dtos);
  }

  /**
   * get the current pdf file with baked TsPdf annotations as Blob
   * @returns 
   */
  getCurrentPdf(): Blob {    
    const data = this._docData?.getDataWithUpdatedAnnotations();
    if (!data?.length) {
      return null;
    }
    const blob = new Blob([data], {
      type: "application/pdf",
    });
    return blob;
  }


  //#region GUI initialization methods
  private initMainDivs() {
    const mainContainer = this._shadowRoot.querySelector("div#main-container") as HTMLDivElement;

    const mcResizeObserver = new ResizeObserver((entries: ResizeObserverEntry[]) => {    
      const {width} = this._mainContainer.getBoundingClientRect();
      if (width < 721) {      
        this._mainContainer.classList.add("mobile");
      } else {      
        this._mainContainer.classList.remove("mobile");
      }
      this._contextMenu.hide();
      this._annotator?.refreshViewBox();
    });
    mcResizeObserver.observe(mainContainer);

    this._mainContainer = mainContainer;
    this._mainContainerRObserver = mcResizeObserver;  

    this._previewer = this._shadowRoot.querySelector("#previewer");
    this._viewer = this._shadowRoot.querySelector("#viewer") as HTMLDivElement;
    this._contextMenu = new ContextMenu();
    this._viewer.addEventListener("contextmenu", (e: MouseEvent) => {
      if (this._contextMenuEnabled) {
        e.preventDefault();
        this._contextMenu.show(new Vec2(e.clientX, e.clientY), this._mainContainer);
      }
    });
  }
  
  /**add event listemers to interface general buttons */
  private initViewControls() {
    const paginatorInput = this._shadowRoot.getElementById("paginator-input") as HTMLInputElement;
    paginatorInput.addEventListener("input", this.onPaginatorInput);
    paginatorInput.addEventListener("change", this.onPaginatorChange);    
    this._shadowRoot.querySelector("#paginator-prev")
      .addEventListener("click", this.onPaginatorPrevClick);
    this._shadowRoot.querySelector("#paginator-next")
      .addEventListener("click", this.onPaginatorNextClick);

    this._shadowRoot.querySelector("#zoom-out")
      .addEventListener("click", this.onZoomOutClick);
    this._shadowRoot.querySelector("#zoom-in")
      .addEventListener("click", this.onZoomInClick);
    this._shadowRoot.querySelector("#zoom-fit-viewer")
      .addEventListener("click", this.onZoomFitViewerClick);
    this._shadowRoot.querySelector("#zoom-fit-page")
      .addEventListener("click", this.onZoomFitPageClick);

    this._shadowRoot.querySelector("#toggle-previewer")
      .addEventListener("click", this.onPreviewerToggleClick);

    this._previewer.addEventListener("scroll", this.onPreviewerScroll);
    this._viewer.addEventListener("scroll", this.onViewerScroll);
    this._viewer.addEventListener("wheel", this.onViewerWheelZoom, {passive: false});
    this._viewer.addEventListener("pointermove", this.onViewerPointerMove);
    this._viewer.addEventListener("pointerdown", this.onViewerPointerDownScroll);    
    this._viewer.addEventListener("touchstart", this.onViewerTouchZoom);     
  }

  private initFileButtons(fileButtons: FileButtons[]) {
    const openButton = this._shadowRoot.querySelector("#button-open-file");
    const saveButton = this._shadowRoot.querySelector("#button-save-file");
    const closeButton = this._shadowRoot.querySelector("#button-close-file");

    if (fileButtons.includes("open")) {
      this._fileInput = this._shadowRoot.getElementById("open-file-input") as HTMLInputElement;
      this._fileInput.addEventListener("change", this.onFileInput);
      openButton.addEventListener("click", this._fileOpenAction || this.onOpenFileButtonClick);
    } else {
      openButton.remove();
    }

    if (fileButtons.includes("save")) {
      saveButton.addEventListener("click", this._fileSaveAction || this.onSaveFileButtonClick);
    } else {
      saveButton.remove();
    }
    
    if (fileButtons.includes("close")) {
      closeButton.addEventListener("click", this._fileCloseAction || this.onCloseFileButtonClick);
    } else {
      closeButton.remove();
    }
  }

  //#region default file buttons actions
  private onFileInput = () => {
    const files = this._fileInput.files;    
    if (files.length === 0) {
      return;
    }

    this.openPdfAsync(files[0]);    

    this._fileInput.value = null;
  };

  private onOpenFileButtonClick = () => {    
    this._shadowRoot.getElementById("open-file-input").click();
  };

  private onSaveFileButtonClick = () => {
    const blob = this.getCurrentPdf();
    if (!blob) {
      return;
    }

    // DEBUG
    // this.openPdfAsync(blob);

    TsPdfViewer.downloadFile(blob, `file_${new Date().toISOString()}.pdf`);
  };
  
  private onCloseFileButtonClick = () => {
    this.closePdfAsync();
  };
  //#endregion

  private initModeSwitchButtons() {
    this._shadowRoot.querySelector("#button-mode-text")
      .addEventListener("click", this.onTextModeButtonClick);
    this._shadowRoot.querySelector("#button-mode-hand")
      .addEventListener("click", this.onHandModeButtonClick);
    this._shadowRoot.querySelector("#button-mode-annotation")
      .addEventListener("click", this.onAnnotationModeButtonClick);
    this.setViewerMode("text");    
  }

  private initAnnotationButtons() {
    // mode buttons
    this._shadowRoot.querySelector("#button-annotation-mode-select")
      .addEventListener("click", this.onAnnotationSelectModeButtonClick);
    this._shadowRoot.querySelector("#button-annotation-mode-stamp")
      .addEventListener("click", this.onAnnotationStampModeButtonClick);
    this._shadowRoot.querySelector("#button-annotation-mode-pen")
      .addEventListener("click", this.onAnnotationPenModeButtonClick);
    // this._shadowRoot.querySelector("#button-annotation-mode-geometric")
    //   .addEventListener("click", this.onAnnotationGeometricModeButtonClick); 

    // select buttons
    this._shadowRoot.querySelector("#button-annotation-delete")
      .addEventListener("click", this.onAnnotationDeleteButtonClick);     

    // pen buttons
    this._viewer.addEventListener("tspdf-penpathchange", (e: PathChangeEvent) => {
      if (e.detail.pathCount) {
        this._mainContainer.classList.add("pen-path-present");
      } else {
        this._mainContainer.classList.remove("pen-path-present");
      }
    });
    this._shadowRoot.querySelector("#button-annotation-pen-undo")
      .addEventListener("click", () => {
        if (this._annotator instanceof PenAnnotator) {
          this._annotator.undoPath();
        }
      });
    this._shadowRoot.querySelector("#button-annotation-pen-clear")
      .addEventListener("click", () => {
        if (this._annotator instanceof PenAnnotator) {
          this._annotator.clearPaths();
        }
      });
    this._shadowRoot.querySelector("#button-annotation-pen-save")
      .addEventListener("click", () => {
        if (this._annotator instanceof PenAnnotator) {
          this._annotator.savePathsAsInkAnnotation();
        }
      });
  }
  //#endregion


  private onPdfLoadingProgress = (progressData: { loaded: number; total: number }) => {
    // TODO: implement progress display
  };

  /**
   * refresh the loaded pdf file page views and previews
   * @returns 
   */
  private async refreshPagesAsync(): Promise<void> { 
    this._pages.forEach(x => {
      x.previewContainer.removeEventListener("click", this.onPreviewerPageClick);
      x.destroy();
    });
    this._pages.length = 0;

    const docPagesNumber = this._pdfDocument?.numPages || 0;
    this._shadowRoot.getElementById("paginator-total").innerHTML = docPagesNumber + "";
    if (!docPagesNumber) {
      return;
    }

    for (let i = 0; i < docPagesNumber; i++) {    
      const pageProxy = await this._pdfDocument.getPage(i + 1); 

      const page = new PageView(pageProxy, this._docData, this._previewWidth);
      page.scale = this._scale;
      page.previewContainer.addEventListener("click", this.onPreviewerPageClick);
      this._previewer.append(page.previewContainer);
      this._viewer.append(page.viewContainer);

      this._pages.push(page);
    } 
  }

  
  //#region previewer
  private scrollToPreview(pageNumber: number) { 
    const {top: cTop, height: cHeight} = this._previewer.getBoundingClientRect();
    const {top: pTop, height: pHeight} = this._pages[pageNumber].previewContainer.getBoundingClientRect();

    const cCenter = cTop + cHeight / 2;
    const pCenter = pTop + pHeight / 2;

    const scroll = pCenter - cCenter + this._previewer.scrollTop;
    this._previewer.scrollTo(0, scroll);
  }
  
  private onPreviewerToggleClick = () => {
    if (this._previewerHidden) {
      this._mainContainer.classList.remove("hide-previewer");
      this._shadowRoot.querySelector("div#toggle-previewer").classList.add("on");
      this._previewerHidden = false;
      setTimeout(() => this.renderVisiblePreviews(), 1000);
    } else {      
      this._mainContainer.classList.add("hide-previewer");
      this._shadowRoot.querySelector("div#toggle-previewer").classList.remove("on");
      this._previewerHidden = true;
    }
  };

  private onPreviewerPageClick = (e: Event) => {
    let target = <HTMLElement>e.target;
    let pageNumber: number;
    while (target && !pageNumber) {
      const data = target.dataset["pageNumber"];
      if (data) {
        pageNumber = +data;
      } else {
        target = target.parentElement;
      }
    }    
    if (pageNumber) {
      this.scrollToPage(pageNumber - 1);
    }
  };
  
  private onPreviewerScroll = (e: Event) => {
    this.renderVisiblePreviews();
  };
  //#endregion
 

  //#region viewer  
  private onViewerPointerMove = (event: PointerEvent) => {
    const {clientX, clientY} = event;
    const {x: rectX, y: rectY, width, height} = this._viewer.getBoundingClientRect();

    const l = clientX - rectX;
    const t = clientY - rectY;
    const r = width - l;
    const b = height - t;

    if (Math.min(l, r, t, b) > 100) {
      if (!this._panelsHidden && !this._timers.hidePanels) {
        this._timers.hidePanels = setTimeout(() => {
          this._mainContainer.classList.add("hide-panels");
          this._panelsHidden = true;
          this._timers.hidePanels = null;
        }, 5000);
      }      
    } else {
      if (this._timers.hidePanels) {
        clearTimeout(this._timers.hidePanels);
        this._timers.hidePanels = null;
      }
      if (this._panelsHidden) {        
        this._mainContainer.classList.remove("hide-panels");
        this._panelsHidden = false;
      }
    }

    this._pointerInfo.lastPos = new Vec2(clientX, clientY);
  };

  //#region viewer modes
  private setViewerMode(mode: ViewerMode) {
    // return if mode not changed
    if (!mode || mode === this._viewerMode) {
      return;
    }

    // disable previous viewer mode
    this.disableCurrentViewerMode();

    switch (mode) {
      case "text":
        this._mainContainer.classList.add("mode-text");
        this._shadowRoot.querySelector("#button-mode-text").classList.add("on");
        break;
      case "hand":
        this._mainContainer.classList.add("mode-hand");
        this._shadowRoot.querySelector("#button-mode-hand").classList.add("on");
        break;
      case "annotation":
        this._mainContainer.classList.add("mode-annotation");
        this._shadowRoot.querySelector("#button-mode-annotation").classList.add("on");
        break;
      default:
        // Execution should not come here
        throw new Error(`Invalid viewer mode: ${mode}`);
    }
    this._viewerMode = mode;
  }

  private disableCurrentViewerMode() { 
    this._contextMenu.clear();
    this._contextMenuEnabled = false;
    
    switch (this._viewerMode) {
      case "text":
        this._mainContainer.classList.remove("mode-text");
        this._shadowRoot.querySelector("#button-mode-text").classList.remove("on");
        break;
      case "hand":
        this._mainContainer.classList.remove("mode-hand");
        this._shadowRoot.querySelector("#button-mode-hand").classList.remove("on");
        break;
      case "annotation":
        this._mainContainer.classList.remove("mode-annotation");
        this._shadowRoot.querySelector("#button-mode-annotation").classList.remove("on");
        this.setAnnotationMode("select");
        break;
      default:
        // mode hasn't been set yet. do nothing
        break;
    }
  }  
  
  private onTextModeButtonClick = () => {
    this.setViewerMode("text");
  };

  private onHandModeButtonClick = () => {
    this.setViewerMode("hand");
  };
  
  private onAnnotationModeButtonClick = () => {
    this.setViewerMode("annotation");
  };
  //#endregion

  //#region viewer scroll
  private scrollToPage(pageNumber: number) { 
    const {top: cTop} = this._viewer.getBoundingClientRect();
    const {top: pTop} = this._pages[pageNumber].viewContainer.getBoundingClientRect();

    const scroll = pTop - (cTop - this._viewer.scrollTop);
    this._viewer.scrollTo(this._viewer.scrollLeft, scroll);
  }
  
  private onViewerScroll = (e: Event) => {
    this._contextMenu.hide();
    this.renderVisiblePages();
  };  

  private onViewerPointerDownScroll = (event: PointerEvent) => { 
    if (this._viewerMode !== "hand") {
      return;
    }
    
    const {clientX, clientY} = event;
    this._pointerInfo.downPos = new Vec2(clientX, clientY);
    this._pointerInfo.downScroll = new Vec2(this._viewer.scrollLeft,this._viewer.scrollTop);    

    const onPointerMove = (moveEvent: PointerEvent) => {
      const {x, y} = this._pointerInfo.downPos;
      const {x: left, y: top} = this._pointerInfo.downScroll;
      const dX = moveEvent.clientX - x;
      const dY = moveEvent.clientY - y;
      this._viewer.scrollTo(left - dX, top - dY);
    };
    
    const onPointerUp = (upEvent: PointerEvent) => {
      this._pointerInfo.downPos = null;
      this._pointerInfo.downScroll = null;

      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointerout", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointerout", onPointerUp);
  };
  //#endregion

  //#region viewer zoom
  private setScale(scale: number, cursorPosition: Vec2 = null) {
    if (!scale || scale === this._scale) {
      return;
    }

    let pageContainerUnderPivot: HTMLElement;
    let xPageRatio: number;
    let yPageRatio: number;

    if (cursorPosition) {
      for (const page of this._pages) {
        const {x: x, y: y} = cursorPosition;
        const {x: pX, y: pY, width: pWidth, height: pHeight} = page.viewContainer.getBoundingClientRect();
        // get page under cursor
        if (pX <= x 
          && pX + pWidth >= x
          && pY <= y
          && pY + pHeight >= y) {          
          // get cursor position relative to page dimensions before scaling
          pageContainerUnderPivot = page.viewContainer;
          xPageRatio = (x - pX) / pWidth;
          yPageRatio = (y - pY) / pHeight;    
          break;
        }
      }
    }

    this._contextMenu.hide();
    this._scale = scale;
    this._pages.forEach(x => x.scale = this._scale);  
    
    if (pageContainerUnderPivot 
      && // check if page has scrollbars
      (this._viewer.scrollHeight > this._viewer.clientHeight
      || this._viewer.scrollWidth > this._viewer.clientWidth)) {

      // get the position of the point under cursor after scaling   
      const {x: initialX, y: initialY} = cursorPosition;
      const {x: pX, y: pY, width: pWidth, height: pHeight} = pageContainerUnderPivot.getBoundingClientRect();
      const resultX = pX + (pWidth * xPageRatio);
      const resultY = pY + (pHeight * yPageRatio);

      // scroll page to move the point to its initial position in the viewport
      let scrollLeft = this._viewer.scrollLeft + (resultX - initialX);
      let scrollTop = this._viewer.scrollTop + (resultY - initialY);
      scrollLeft = scrollLeft < 0 
        ? 0 
        : scrollLeft;
      scrollTop = scrollTop < 0
        ? 0
        : scrollTop;

      if (scrollTop !== this._viewer.scrollTop
        || scrollLeft !== this._viewer.scrollLeft) {          
        this._viewer.scrollTo(scrollLeft, scrollTop);
        // render will be called from the scroll event handler so no need to call it from here
        return;
      }
    }

    // use timeout to let browser update page layout
    setTimeout(() => this.renderVisiblePages(), 0);
  }

  private zoom(diff: number, cursorPosition: Vec2 = null) {
    const scale = clamp(this._scale + diff, this._minScale, this._maxScale);
    this.setScale(scale, cursorPosition || this.getViewerCenterPosition());
  }

  private zoomOut(cursorPosition: Vec2 = null) {
    this.zoom(-0.25, cursorPosition);
  }
  
  private zoomIn(cursorPosition: Vec2 = null) {
    this.zoom(0.25, cursorPosition);
  }

  private getViewerCenterPosition(): Vec2 {
    const {x, y, width, height} = this._viewer.getBoundingClientRect();
    return new Vec2(x + width / 2, y + height / 2);
  }
  
  private onViewerWheelZoom = (event: WheelEvent) => {
    if (!event.ctrlKey) {
      return;
    }

    event.preventDefault();
    if (event.deltaY > 0) {
      this.zoomOut(this._pointerInfo.lastPos);
    } else {
      this.zoomIn(this._pointerInfo.lastPos);
    }
  };  

  private onViewerTouchZoom = (event: TouchEvent) => { 
    if (event.touches.length !== 2) {
      return;
    }    

    const a = event.touches[0];
    const b = event.touches[1];    
    this._pinchInfo.active = true;
    this._pinchInfo.lastDist = getDistance(a.clientX, a.clientY, b.clientX, b.clientY);

    const onTouchMove = (moveEvent: TouchEvent) => {
      if (moveEvent.touches.length !== 2) {
        return;
      }

      const mA = moveEvent.touches[0];
      const mB = moveEvent.touches[1];    
      const dist = getDistance(mA.clientX, mA.clientY, mB.clientX, mB.clientY);
      const delta = dist - this._pinchInfo.lastDist;
      const factor = Math.floor(delta / this._pinchInfo.minDist);  

      if (factor) {
        const center = new Vec2((mB.clientX + mA.clientX) / 2, (mB.clientY + mA.clientY) / 2);
        this._pinchInfo.lastDist = dist;
        this.zoom(factor * this._pinchInfo.sensitivity, center);
      }
    };
    
    const onTouchEnd = (endEvent: TouchEvent) => {
      this._pinchInfo.active = false;
      this._pinchInfo.lastDist = 0;

      (<HTMLElement>event.target).removeEventListener("touchmove", onTouchMove);
      (<HTMLElement>event.target).removeEventListener("touchend", onTouchEnd);
      (<HTMLElement>event.target).removeEventListener("touchcancel", onTouchEnd);
    };

    (<HTMLElement>event.target).addEventListener("touchmove", onTouchMove);
    (<HTMLElement>event.target).addEventListener("touchend", onTouchEnd);
    (<HTMLElement>event.target).addEventListener("touchcancel", onTouchEnd);
  };

  private onZoomOutClick = () => {
    this.zoomOut();
  };

  private onZoomInClick = () => {
    this.zoomIn();
  };
  
  private onZoomFitViewerClick = () => {
    const cWidth = this._viewer.getBoundingClientRect().width;
    const pWidth = this._pages[this._currentPage].viewContainer.getBoundingClientRect().width;
    const scale = clamp((cWidth  - 20) / pWidth * this._scale, this._minScale, this._maxScale);
    this.setScale(scale);
    this.scrollToPage(this._currentPage);
  };
  
  private onZoomFitPageClick = () => {
    const { width: cWidth, height: cHeight } = this._viewer.getBoundingClientRect();
    const { width: pWidth, height: pHeight } = this._pages[this._currentPage].viewContainer.getBoundingClientRect();
    const hScale = clamp((cWidth - 20) / pWidth * this._scale, this._minScale, this._maxScale);
    const vScale = clamp((cHeight - 20) / pHeight * this._scale, this._minScale, this._maxScale);
    this.setScale(Math.min(hScale, vScale));
    this.scrollToPage(this._currentPage);
  };
  //#endregion

  //#endregion


  //#region pages and paginator
  /**
   * get page views/previews that are visible in the viewer viewport at the moment
   * @param container 
   * @param pages
   * @param preview true: get the previews, false: get the views
   * @returns 
   */
  private getVisiblePages(container: HTMLDivElement, pages: PageView[], preview = false): Set<number> {
    const pagesVisible = new Set<number>();
    if (!pages.length) {
      return pagesVisible;
    }

    const cRect = container.getBoundingClientRect();
    const cTop = cRect.top;
    const cBottom = cRect.top + cRect.height;

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const pRect = preview
        ? page.previewContainer.getBoundingClientRect()
        : page.viewContainer.getBoundingClientRect();
      const pTop = pRect.top;
      const pBottom = pRect.top + pRect.height;

      if (pTop < cBottom && pBottom > cTop) {
        pagesVisible.add(i);
      } else if (pagesVisible.size) {
        break;
      }
    }
    return pagesVisible;
  }
  
  /**
   * get the current page
   * @param container 
   * @param pages 
   * @param visiblePageNumbers 
   * @returns the page that takes more than a half of the available viewer space or the topmost one if multiple pages take less space
   */
  private getCurrentPage(container: HTMLDivElement, pages: PageView[], visiblePageNumbers: Set<number>): number {
    const visiblePageNumbersArray = [...visiblePageNumbers];
    if (!visiblePageNumbersArray.length) {
      // no visible pages = no current page
      return -1;
    } else if (visiblePageNumbersArray.length === 1) {
      // the only visible page = the current page
      return visiblePageNumbersArray[0];
    }

    const cRect = container.getBoundingClientRect();
    const cTop = cRect.top;
    const cMiddle = cRect.top + cRect.height / 2;

    for (const i of visiblePageNumbersArray) {
      const pRect = pages[i].viewContainer.getBoundingClientRect();
      const pTop = pRect.top;

      if (pTop > cTop) {
        // the page top is below the container top
        if (pTop > cMiddle) {
          // the page top is below the container center - return the previous page 
          // (as it takes more than a half of the available viewer space)
          return i - 1;
        } else {
          // the page top is above the container center, 
          // so no page takes the most of viewer space.
          // return the topmost one (the current page)
          return i;
        }
      }
    };

    // function should not reach this point with correct arguments
    throw new Error("Incorrect argument");
  }   
  
  private renderVisiblePreviews() {
    if (this._previewerHidden) {
      return;
    }

    const pages = this._pages;
    const visiblePreviewNumbers = this.getVisiblePages(this._previewer, pages, true);
    
    const minPageNumber = Math.max(Math.min(...visiblePreviewNumbers) - this._visibleAdjPages, 0);
    const maxPageNumber = Math.min(Math.max(...visiblePreviewNumbers) + this._visibleAdjPages, pages.length - 1);

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      if (i >= minPageNumber && i <= maxPageNumber) {
        page.renderPreviewAsync();
      }
    }
  }  

  private renderVisiblePages() {
    const pages = this._pages;
    const visiblePageNumbers = this.getVisiblePages(this._viewer, pages); 
    
    const prevCurrent = this._currentPage;
    const current = this.getCurrentPage(this._viewer, pages, visiblePageNumbers);
    if (current === -1) {
      return;
    }
    if (!prevCurrent || prevCurrent !== current) {
      pages[prevCurrent]?.previewContainer.classList.remove("current");
      pages[current]?.previewContainer.classList.add("current");
      (<HTMLInputElement>this._shadowRoot.getElementById("paginator-input")).value = current + 1 + "";
      this.scrollToPreview(current);
      this._currentPage = current;
    }
    
    const minPageNumber = Math.max(Math.min(...visiblePageNumbers) - this._visibleAdjPages, 0);
    const maxPageNumber = Math.min(Math.max(...visiblePageNumbers) + this._visibleAdjPages, pages.length - 1);

    const renderedPages: PageView[] = [];
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      renderedPages.push(page);
      if (i >= minPageNumber && i <= maxPageNumber) {
        // render page view and dispatch corresponding event
        page.renderViewAsync();
      } else {
        page.clearView();
      }
    }

    this._renderedPages = renderedPages;
    this.updateAnnotatorPageData();
  } 

  private onPaginatorInput = (event: Event) => {
    if (event.target instanceof HTMLInputElement) {
      event.target.value = event.target.value.replace(/[^\d]+/g, "");
    }
  };
  
  private onPaginatorChange = (event: Event) => {
    if (event.target instanceof HTMLInputElement) {
      const pageNumber = Math.max(Math.min(+event.target.value, this._pdfDocument.numPages), 1);
      if (pageNumber + "" !== event.target.value) {        
        event.target.value = pageNumber + "";
      }
      this.scrollToPage(pageNumber - 1);
    }
  };
  
  private onPaginatorPrevClick = () => {
    const pageNumber = clamp(this._currentPage - 1, 0, this._pages.length - 1);
    this.scrollToPage(pageNumber);
  };

  private onPaginatorNextClick = () => {
    const pageNumber = clamp(this._currentPage + 1, 0, this._pages.length - 1);
    this.scrollToPage(pageNumber);
  };
  //#endregion
  

  //#region annotations
  private onAnnotationDeleteButtonClick = () => {
    this._docData?.deleteSelectedAnnotation();
  };

  private setAnnotationMode(mode: AnnotatorMode) {
    // return if mode is same
    if (!mode || mode === this._annotatorMode) {
      return;
    }

    // disable previous mode
    this._contextMenu.clear();
    this._contextMenuEnabled = false;
    this._annotator?.destroy();

    switch (this._annotatorMode) {
      case "select":
        this._shadowRoot.querySelector("#button-annotation-mode-select").classList.remove("on");
        this._docData.setSelectedAnnotation(null);
        break;
      case "stamp":
        this._shadowRoot.querySelector("#button-annotation-mode-stamp").classList.remove("on");
        break;
      case "pen":
        this._shadowRoot.querySelector("#button-annotation-mode-pen").classList.remove("on");
        break;
      case "geometric":
        this._shadowRoot.querySelector("#button-annotation-mode-geometric").classList.remove("on");
        break;
      default:
        // mode hasn't been set. do nothing
        break;
    }

    this._annotatorMode = mode;
    switch (mode) {
      case "select":
        this._shadowRoot.querySelector("#button-annotation-mode-select").classList.add("on");
        break;
      case "stamp":
        this._shadowRoot.querySelector("#button-annotation-mode-stamp").classList.add("on");
        this._annotator = new StampAnnotator(this._docData, this._viewer);
        this.initContextStampPicker();
        break;
      case "pen":
        this._shadowRoot.querySelector("#button-annotation-mode-pen").classList.add("on");
        this._annotator = new PenAnnotator(this._docData, this._viewer);
        this.initContextPenColorPicker();
        break;
      case "geometric":
        this._shadowRoot.querySelector("#button-annotation-mode-geometric").classList.add("on");
        break;
      default:
        // Execution should not come here
        throw new Error(`Invalid annotation mode: ${mode}`);
    }
    this.updateAnnotatorPageData();
  }

  private onAnnotationSelectModeButtonClick = () => {
    this.setAnnotationMode("select");
  };

  private onAnnotationStampModeButtonClick = () => {
    this.setAnnotationMode("stamp");
  };

  private onAnnotationPenModeButtonClick = () => {
    this.setAnnotationMode("pen");
  };
  
  private onAnnotationGeometricModeButtonClick = () => {
    this.setAnnotationMode("geometric");
  };

  private onAnnotationChange = (e: AnnotEvent) => {
    if (!e.detail) {
      return;
    }

    const annotations = e.detail.annotations;
    switch(e.detail.type) {
      case "select":      
        if (annotations?.length) {
          this._mainContainer.classList.add("annotation-selected");
        } else {
          this._mainContainer.classList.remove("annotation-selected");
        }
        break;
      case "add":
        break;
      case "edit":
        break;
      case "delete":
        break;
    }
    
    // execute change callback if present
    if (this._annotChangeCallback) {
      this._annotChangeCallback(e.detail);
    }

    // rerender changed pages
    if (annotations?.length) {
      const pageIdSet = new Set<number>(annotations.map(x => x.pageId));
      this._renderedPages.forEach(x => {
        if (pageIdSet.has(x.id)) {
          x.renderViewAsync(true);
        }
      });
    }
  };

  private initContextStampPicker() {
    // TODO: move this somewhere where it will fit better
    const stampTypes: {type: string; name: string}[] = [
      {type:"/Draft", name: "Draft"},
      {type:"/Approved", name: "Approved"},
      {type:"/NotApproved", name: "Not Approved"},
      {type:"/Departmental", name: "Departmental"},
    ];

    // init a stamp type picker
    const contextMenuContent = document.createElement("div");
    contextMenuContent.classList.add("context-menu-content", "column");
    stampTypes.forEach(x => {          
      const item = document.createElement("div");
      item.classList.add("context-menu-stamp-select-button");
      item.addEventListener("click", () => {
        this._contextMenu.hide();
        this._annotator?.destroy();
        this._annotator = new StampAnnotator(this._docData, this._viewer, x.type);
        this.updateAnnotatorPageData();
      });
      const stampName = document.createElement("div");
      stampName.innerHTML = x.name;
      item.append(stampName);
      contextMenuContent.append(item);
    });

    // set the stamp type picker as the context menu content
    this._contextMenu.content = [contextMenuContent];
    // enable the context menu
    this._contextMenuEnabled = true;
  }

  private initContextPenColorPicker() {
    // default pen colors
    // TODO: move to the main options
    const colors: Quadruple[] = [
      [0, 0, 0, 0.5], // black
      [0.804, 0, 0, 0.5], // red
      [0, 0.804, 0, 0.5], // green
      [0, 0, 0.804, 0.5], // blue
    ];

    // init a pen color picker
    const contextMenuColorPicker = document.createElement("div");
    contextMenuColorPicker.classList.add("context-menu-content", "row");
    colors.forEach(x => {          
      const item = document.createElement("div");
      item.classList.add("panel-button");
      item.addEventListener("click", () => {
        this._contextMenu.hide();
        this._annotator?.destroy();
        this._annotator = new PenAnnotator(this._docData, this._viewer, {
          color:x,
        });
        this.updateAnnotatorPageData();
      });
      const colorIcon = document.createElement("div");
      colorIcon.classList.add("context-menu-color-icon");
      colorIcon.style.backgroundColor = `rgb(${x[0]*255},${x[1]*255},${x[2]*255})`;
      item.append(colorIcon);
      contextMenuColorPicker.append(item);
    });

    // init a pen stroke width slider
    const contextMenuWidthSlider = document.createElement("div");
    contextMenuWidthSlider.classList.add("context-menu-content", "row");
    const slider = document.createElement("input");
    slider.setAttribute("type", "range");
    slider.setAttribute("min", "1");
    slider.setAttribute("max", "32");
    slider.setAttribute("step", "1");
    slider.setAttribute("value", "3");
    slider.classList.add("context-menu-slider");
    slider.addEventListener("change", () => {      
      this._annotator?.destroy();
      this._annotator = new PenAnnotator(this._docData, this._viewer, {
        strokeWidth: slider.valueAsNumber,
      });
      this.updateAnnotatorPageData();
    });
    contextMenuWidthSlider.append(slider);

    // set the context menu content
    this._contextMenu.content = [contextMenuColorPicker, contextMenuWidthSlider];
    // enable the context menu
    this._contextMenuEnabled = true;
  }

  /**
   * update the current annotator view
   */
  private updateAnnotatorPageData() {    
    if (this._annotator) {
      this._annotator.scale = this._scale;
      this._annotator.renderedPages = this._renderedPages;
      this._annotator.refreshViewBox();
    }
  }
  //#endregion


  //#region misc 
  private async showPasswordDialogAsync(): Promise<string> {

    const passwordPromise = new Promise<string>((resolve, reject) => {

      const dialogContainer = document.createElement("div");
      dialogContainer.id = "password-dialog";
      dialogContainer.innerHTML = passwordDialogHtml;
      this._mainContainer.append(dialogContainer);

      let value = "";      
      const input = this._shadowRoot.getElementById("password-input") as HTMLInputElement;
      input.placeholder = "Enter password...";
      input.addEventListener("change", () => value = input.value);

      const ok = () => {
        dialogContainer.remove();
        resolve(value);
      };
      const cancel = () => {
        dialogContainer.remove();
        resolve(null);
      };

      dialogContainer.addEventListener("click", (e: Event) => {
        if (e.target === dialogContainer) {
          cancel();
        }
      });
      
      this._shadowRoot.getElementById("password-ok").addEventListener("click", ok);
      this._shadowRoot.getElementById("password-cancel").addEventListener("click", cancel);
    });

    return passwordPromise;
  }
  //#endregion
}
