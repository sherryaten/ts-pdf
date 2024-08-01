/* eslint-disable @typescript-eslint/no-use-before-define */
import { GlobalWorkerOptions } from "pdfjs-dist";

import { clamp } from "mathador";
import {
  DomUtils, EventService, Spinner, CustomStampCreationInfo,
  customStampEvent, CustomStampEvent, CustomStampEventDetail,
  CustomStampService
} from "ts-viewers-core";

import { mainHtml, passwordDialogHtml } from "./assets/index.html";
import { styles } from "./assets/styles";

import { getSelectionInfosFromSelection } from "./common/text-selection";
import { AnnotationDto } from "./common/annotation";

import {
  PageService, currentPageChangeEvent,
  CurrentPageChangeEvent
} from "./services/page-service";
import {
  DocumentService, annotChangeEvent, AnnotEvent,
  AnnotEventDetail, DocServiceStateChangeEvent,
  docServiceStateChangeEvent
} from "./services/document-service";
import { AnnotatorService, AnnotatorServiceMode } from "./services/annotator-service";
import { ModeService, ViewerMode, viewerModes } from "./services/mode-service";
import {
  DocChangeEvent, docChangeEvent,
  DocManagerService, DocType
} from "./services/doc-manager-service";

import { Viewer } from "./components/viewer";
import { Previewer } from "./components/previewer";

import {
  annotatorDataChangeEvent, AnnotatorDataChangeEvent,
  annotatorTypes,
  TextSelectionChangeEvent,
  textSelectionChangeEvent
} from "./annotator/annotator";

declare global {
  interface HTMLElementEventMap {
    [customStampEvent]: CustomStampEvent;
  }
}

export type BaseFileButtons = "open" | "close";
export type FileButtons = BaseFileButtons | "save";

export interface TsPdfViewerOptions {
  /**parent container CSS selector */
  containerSelector: string;
  /**path to the PDF.js worker */
  workerSource: string;
  /**current user name (used for annotations) */
  userName?: string;

  /**
   * action to execute on annotation change event 
   * f.e. to save the changes to the database
   */
  annotChangeCallback?: (detail: AnnotEventDetail) => void;

  /**
   * array of objects describing custom stamps
   */
  customStamps?: CustomStampCreationInfo[];

  /**
   * action to execute on custom stamp change event.
   * fires when a new custom stamp is added or an old one is deleted.
   * can be used for managing custom stamp library
   */
  customStampChangeCallback?: (detail: CustomStampEventDetail) => void;

  /**
   * number of pages that should be prerendered outside view 
   * higher values can reduce performance and will increase memory use
   */
  visibleAdjPages?: number;
  /**page preview canvas width in px */
  previewWidth?: number;

  minScale?: number;
  maxScale?: number;

  /**list of the viewer modes to disable */
  disabledModes?: ViewerMode[];

  /**list of the file interaction buttons shown*/
  fileButtons?: FileButtons[];
  /**
   * action to execute instead of the default file open action
   * f.e. to open a custom dialog that allows the user to select a file from the database
   */
  fileOpenAction?: () => void;
  /**
   * action to execute instead of the default file download action
   * f.e. to save the file bytes to the database instead of downloading it
   */
  fileSaveAction?: () => void;
  /**
   * action to execute instead of the default file close action
   * f.e. to discard all the changes made to the file
   */
  fileCloseAction?: () => void;

  /**list of the comparable file interaction buttons shown*/
  comparableFileButtons?: BaseFileButtons[];
  /**
   * action to execute instead of the default file open action
   * f.e. to open a custom dialog that allows the user to select a file from the database
   */
  comparableFileOpenAction?: () => void;
  /**
   * action to execute instead of the default file close action
   * f.e. to discard all the changes made to the file
   */
  comparableFileCloseAction?: () => void;
}

export class TsPdfViewer {
  //#region private fields
  private readonly _userName: string;

  private readonly _outerContainer: HTMLDivElement;
  private readonly _shadowRoot: ShadowRoot;
  private readonly _mainContainer: HTMLDivElement;

  private readonly _eventService: EventService;
  private readonly _modeService: ModeService;
  private readonly _docManagerService: DocManagerService;
  private readonly _pageService: PageService;
  private readonly _customStampsService: CustomStampService;

  private get _docService(): DocumentService {
    return this._docManagerService?.docService;
  }

  private readonly _spinner: Spinner;
  private readonly _viewer: Viewer;
  private readonly _previewer: Previewer;

  private _annotatorService: AnnotatorService;

  //#region file actions
  private _fileButtons: FileButtons[];
  private _comparableFileButtons: BaseFileButtons[];

  private _fileInput: HTMLInputElement;
  private _comparableFileInput: HTMLInputElement;

  private _fileOpenAction: () => void;
  private _fileSaveAction: () => void;
  private _fileCloseAction: () => void;
  private _comparableFileOpenAction: () => void;
  private _comparableFileCloseAction: () => void;
  //#endregion

  private _annotChangeCallback: (detail: AnnotEventDetail) => void;
  private _customStampChangeCallback: (detail: CustomStampEventDetail) => void;

  private _mainContainerRObserver: ResizeObserver;
  private _panelsHidden: boolean;

  /**common timers */
  private _timers = {
    hidePanels: 0,
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
    this._fileButtons = options.fileButtons || [];
    this._fileOpenAction = options.fileOpenAction;
    this._fileSaveAction = options.fileSaveAction;
    this._fileCloseAction = options.fileCloseAction;
    this._comparableFileButtons = options.comparableFileButtons || [];
    this._comparableFileOpenAction = options.comparableFileOpenAction;
    this._comparableFileCloseAction = options.comparableFileCloseAction;
    this._annotChangeCallback = options.annotChangeCallback;
    this._customStampChangeCallback = options.customStampChangeCallback;

    const visibleAdjPages = options.visibleAdjPages || 0;
    const previewWidth = options.previewWidth || 100;
    const minScale = options.minScale || 0.25;
    const maxScale = options.maxScale || 4;
    if (!!this._outerContainer.shadowRoot == false) {
      this._shadowRoot = this._outerContainer.attachShadow({ mode: "open" });
    } else {
      this._shadowRoot = this._outerContainer.shadowRoot
    }
    this._shadowRoot.innerHTML = styles + mainHtml;
    this._mainContainer = this._shadowRoot.querySelector("div#main-container") as HTMLDivElement;

    this._eventService = new EventService(this._mainContainer);
    this._modeService = new ModeService({ disabledModes: options.disabledModes || [] });
    this._docManagerService = new DocManagerService(this._eventService);
    this._pageService = new PageService(this._eventService, this._modeService, this._docManagerService,
      { previewCanvasWidth: previewWidth, visibleAdjPages: visibleAdjPages });

    this._customStampsService = new CustomStampService(this._mainContainer, this._eventService);
    this._customStampsService.importCustomStamps(options.customStamps);

    this._spinner = new Spinner();
    this._previewer = new Previewer(this._pageService, this._shadowRoot.querySelector("#previewer"));
    this._viewer = new Viewer(this._modeService, this._pageService, this._shadowRoot.querySelector("#viewer"),
      { minScale: minScale, maxScale: maxScale });
    this._viewer.container.addEventListener("contextmenu", e => e.preventDefault());

    this.initMainContainerEventHandlers();
    this.initViewControls();
    this.initFileButtons();
    this.initModeSwitchButtons();
    this.initAnnotationButtons();

    this._eventService.addListener(docChangeEvent, this.onDocChangeAsync);
    this._eventService.addListener(annotChangeEvent, this.onAnnotationChange);
    this._eventService.addListener(currentPageChangeEvent, this.onCurrentPagesChanged);
    this._eventService.addListener(annotatorDataChangeEvent, this.onAnnotatorDataChanged);
    this._eventService.addListener(customStampEvent, this.onCustomStampChanged);
    this._eventService.addListener(docServiceStateChangeEvent, this.onDocServiceStateChange);

    document.addEventListener("selectionchange", this.onTextSelectionChange);

    this._mainContainer.addEventListener("keydown", this.onViewerKeyDown);
  }

  //#region public API
  /**free resources to let GC clean them to avoid memory leak */
  destroy() {
    this._annotChangeCallback = null;

    this._annotatorService?.destroy();

    this._docManagerService.destroy();
    this._viewer.destroy();
    this._previewer.destroy();
    this._pageService.destroy();

    this._customStampsService.destroy();
    this._eventService.destroy();

    this._mainContainerRObserver?.disconnect();
    this._shadowRoot.innerHTML = "";

    document.removeEventListener("selectionchange", this.onTextSelectionChange);
  }

  /**
   * open PDF file
   * @param src file URI, base64 string, Blob instance, byte array
   * @param fileName 
   */
  async openPdfAsync(src: string | Blob | Uint8Array,
    fileName?: string): Promise<void> {
    await this.openDocAsync("main", src, fileName);
  }

  async closePdfAsync(): Promise<void> {
    await this.closeDocAsync("main");
  }

  /**
   * open PDF file for the main file to be compared with.
   * does nothing if the main file hasn't been not loaded yet.
   * automatically sets viewer mode to 'comparison'
   * @param src file URI, base64 string, Blob instance, byte array
   * @param fileName 
   */
  async openComparedPdfAsync(src: string | Blob | Uint8Array,
    fileName?: string): Promise<void> {
    if (!this._docManagerService.docLoaded) {
      return;
    }
    await this.openDocAsync("compared", src, fileName);
    this.setMode("comparison");
  }

  /**
   * 
   * automatically sets viewer mode to the default one after closing is completed
   */
  async closeComparedPdfAsync(): Promise<void> {
    await this.closeDocAsync("compared");
    this.setMode();
  }

  /**
   * import previously exported TsPdf annotations
   * @param dtos annotation data transfer objects
   */
  async importAnnotationsAsync(dtos: AnnotationDto[]) {
    try {
      await this._docService?.appendSerializedAnnotationsAsync(dtos);
    } catch (e) {
      console.log(`Error while importing annotations: ${e.message}`);
    }
  }

  /**
   * import previously exported serialized TsPdf annotations
   * @param json serialized annotation data transfer objects
   */
  async importAnnotationsFromJsonAsync(json: string) {
    try {
      const dtos: AnnotationDto[] = JSON.parse(json);
      await this._docService?.appendSerializedAnnotationsAsync(dtos);
    } catch (e) {
      console.log(`Error while importing annotations: ${e.message}`);
    }
  }

  /**
   * export TsPdf annotations as data transfer objects
   * @returns 
   */
  async exportAnnotationsAsync(): Promise<AnnotationDto[]> {
    const dtos = await this._docService?.serializeAnnotationsAsync(true);
    return dtos;
  }

  /**
   * export TsPdf annotations as a serialized array of data transfer objects
   * @returns 
   */
  async exportAnnotationsToJsonAsync(): Promise<string> {
    const dtos = await this._docService?.serializeAnnotationsAsync(true);
    return JSON.stringify(dtos);
  }

  importCustomStamps(customStamps: CustomStampCreationInfo[]) {
    try {
      this._customStampsService.importCustomStamps(customStamps);
    } catch (e) {
      console.log(`Error while importing custom stamps: ${e.message}`);
    }
  }

  importCustomStampsFromJson(json: string) {
    try {
      const customStamps: CustomStampCreationInfo[] = JSON.parse(json);
      this._customStampsService.importCustomStamps(customStamps);
    } catch (e) {
      console.log(`Error while importing custom stamps: ${e.message}`);
    }
  }

  /**
   * export TsPdf custom stamps
   * @returns 
   */
  exportCustomStamps(): CustomStampCreationInfo[] {
    const customStamps = this._customStampsService.getCustomStamps();
    return customStamps;
  }

  /**
   * export TsPdf custom stamps as a serialized array of the corresponding objects
   * @returns 
   */
  exportCustomStampsToJson(): string {
    const customStamps = this._customStampsService.getCustomStamps();
    return JSON.stringify(customStamps);
  }

  /**
   * get the current pdf file with baked TsPdf annotations as Blob
   * @returns 
   */
  async getCurrentPdfAsync(): Promise<Blob> {
    const data = await this._docService?.getDataWithUpdatedAnnotationsAsync();
    if (!data?.length) {
      return null;
    }
    const blob = new Blob([data], {
      type: "application/pdf",
    });
    return blob;
  }
  //#endregion

  //#region text selection
  protected onTextSelectionChange = () => {
    const selection: Selection = (<any>this._shadowRoot).getSelection
      ? (<any>this._shadowRoot).getSelection() // Note: for Chrome
      : document.getSelection(); // Note: for FF and Safari
    if (!selection.rangeCount) {
      return;
    }

    if (this._eventService.hasListenersForKey(textSelectionChangeEvent)) {
      // get selection text and coordinates
      const selectionInfos = getSelectionInfosFromSelection(selection);
      this._eventService.dispatchEvent(new TextSelectionChangeEvent({ selectionInfos }));
    }
  };
  //#endregion

  //#region open/close
  private async openDocAsync(type: DocType,
    src: string | Blob | Uint8Array, fileName?: string): Promise<void> {
    this._spinner.show(this._mainContainer);

    try {
      await this._docManagerService.openPdfAsync(type, src, fileName,
        this._userName, this.showPasswordDialogAsync, this.onPdfLoadingProgress);
    } catch (e) {
      throw e;
    } finally {
      this._spinner.hide();
    }
  }

  private async closeDocAsync(type: DocType): Promise<void> {
    // destroy a running loading task if present
    await this._docManagerService.closePdfAsync(type);
  }
  //#endregion

  //#region GUI initialization methods
  private initMainContainerEventHandlers() {
    const mcResizeObserver = new ResizeObserver((entries: ResizeObserverEntry[]) => {
      const { width } = this._mainContainer.getBoundingClientRect();
      if (width < 721) {
        this._mainContainer.classList.add("mobile");
      } else {
        this._mainContainer.classList.remove("mobile");
      }
      if (width < 400) {
        this._mainContainer.classList.add("compact");
      } else {
        this._mainContainer.classList.remove("compact");
      }
    });
    mcResizeObserver.observe(this._mainContainer);
    this._mainContainerRObserver = mcResizeObserver;
    this._mainContainer.addEventListener("pointermove", this.onMainContainerPointerMove);
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

    this._shadowRoot.querySelector("#rotate-clockwise")
      .addEventListener("click", this.onRotateClockwiseClick);
    this._shadowRoot.querySelector("#rotate-counter-clockwise")
      .addEventListener("click", this.onRotateCounterClockwiseClick);

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
     this.togglePreviewer()
  }

  private initFileButtons() {
    const openButton = this._shadowRoot.querySelector("#button-open-file");
    const saveButton = this._shadowRoot.querySelector("#button-save-file");
    const closeButton = this._shadowRoot.querySelector("#button-close-file");

    if (this._fileButtons.includes("open")) {
      this._fileInput = this._shadowRoot.getElementById("open-file-input") as HTMLInputElement;
      this._fileInput.addEventListener("change", this.onFileInput);
      openButton.addEventListener("click", this._fileOpenAction || this.onOpenFileButtonClick);
    } else {
      openButton.remove();
    }

    if (this._fileButtons.includes("save")) {
      saveButton.addEventListener("click", this._fileSaveAction || this.onSaveFileButtonClickAsync);
    } else {
      saveButton.remove();
    }

    if (this._fileButtons.includes("close")) {
      closeButton.addEventListener("click", this._fileCloseAction || this.onCloseFileButtonClick);
    } else {
      closeButton.remove();
    }

    const comparableOpenButton = this._shadowRoot.querySelector("#button-command-comparison-open");
    const comparableCloseButton = this._shadowRoot.querySelector("#button-command-comparison-close");

    if (this._comparableFileButtons.includes("open")) {
      this._comparableFileInput = this._shadowRoot
        .getElementById("open-comparable-file-input") as HTMLInputElement;
      this._comparableFileInput.addEventListener("change", this.onComparableFileInput);
      comparableOpenButton.addEventListener("click",
        this._comparableFileOpenAction || this.onComparableOpenFileButtonClick);
    } else {
      comparableOpenButton.remove();
    }

    if (this._comparableFileButtons.includes("close")) {
      comparableCloseButton.addEventListener("click",
        this._comparableFileCloseAction || this.onComparableCloseFileButtonClick);
    } else {
      comparableCloseButton.remove();
    }
  }

  //#region default file buttons actions
  private onFileInput = () => {
    const files = this._fileInput.files;
    if (files.length === 0) {
      return;
    }

    this.openDocAsync("main", files[0], files[0].name);

    this._fileInput.value = null;
  };

  private onOpenFileButtonClick = () => {
    this._fileInput.click();
  };

  private onSaveFileButtonClickAsync = async () => {
    const blob = await this.getCurrentPdfAsync();
    if (!blob) {
      return;
    }

    // DEBUG
    // this.openPdfAsync(blob);

    DomUtils.downloadFile(blob, this._docManagerService?.fileName
      || `file_${new Date().toISOString()}.pdf`);
  };

  private onCloseFileButtonClick = () => {
    this.closeDocAsync("main");
  };

  private onComparableFileInput = () => {
    const files = this._comparableFileInput.files;
    if (files.length === 0) {
      return;
    }

    this.openDocAsync("compared", files[0], files[0].name);

    this._comparableFileInput.value = null;
  };

  private onComparableOpenFileButtonClick = () => {
    this._comparableFileInput.click();
  };

  private onComparableCloseFileButtonClick = () => {
    this.closeDocAsync("compared");
  };
  //#endregion

  private initModeSwitchButtons() {
    const modeButtons = this._shadowRoot.querySelectorAll("*[id^=\"button-mode-\"]");
    const enabledModes = this._modeService.enabledModes;
    modeButtons.forEach(x => {
      const mode = /button-mode-(.+)/.exec(x.id)[1] as ViewerMode;
      if (enabledModes.includes(mode)) {
        x.addEventListener("click", this.onViewerModeButtonClick);
      } else {
        x.classList.add("disabled");
      }
    });
  }

  private initAnnotationButtons() {
    // mode buttons
    this._shadowRoot.querySelectorAll("*[id^=\"button-annotation-mode-\"]")
      .forEach(x => {
        x.addEventListener("click", this.onAnnotationModeButtonClick);
      });

    // select buttons
    this._shadowRoot.querySelector("#button-annotation-edit-text")
      .addEventListener("click", this.onAnnotationEditTextButtonClick);
    this._shadowRoot.querySelector("#button-annotation-delete")
      .addEventListener("click", this.onAnnotationDeleteButtonClick);

    // annotator buttons
    this._shadowRoot.querySelectorAll(".button-annotation-undo")
      .forEach(x => x.addEventListener("click", this.annotatorUndo));
    this._shadowRoot.querySelectorAll(".button-annotation-clear")
      .forEach(x => x.addEventListener("click", this.annotatorClear));
    this._shadowRoot.querySelectorAll(".button-annotation-save")
      .forEach(x => x.addEventListener("click", this.annotatorSave));
    this._shadowRoot.querySelectorAll(".button-annotation-options")
      .forEach(x => x.addEventListener("click", this.annotatorOptions));
    this._shadowRoot.querySelector("#button-command-undo")
      .addEventListener("click", this.docServiceUndo);
  }
  //#endregion

  //#region viewer modes
  private setMode(mode?: ViewerMode) {
    mode = mode || this._modeService.enabledModes[0] || "text"; // 'text' is the default mode

    // disable previous viewer mode
    viewerModes.forEach(x => {
      this._mainContainer.classList.remove("mode-" + x);
      this._shadowRoot.querySelector("#button-mode-" + x).classList.remove("on");
    });
    this.setAnnotationMode("select");

    this._mainContainer.classList.add("mode-" + mode);
    this._shadowRoot.querySelector("#button-mode-" + mode).classList.add("on");
    this._modeService.mode = mode;

    this._viewer.renderVisible();
  }

  private onViewerModeButtonClick = (e: Event) => {
    const parentButton = (<Element>e.target).closest("*[id^=\"button-mode-\"]");
    if (!parentButton) {
      return;
    }
    const mode = /button-mode-(.+)/.exec(parentButton.id)[1] as ViewerMode;
    
    if(mode == "bookmark" || mode == "save" || mode == "list") {
      const message = {
          type: mode+'Clicked',
        };
        window.parent.postMessage(message, '*');
  }else{
      this.setMode(mode);
    }
  };
  //#endregion

  //#region viewer zoom
  private onZoomOutClick = () => {
    this._viewer.zoomOut();
  };

  private onZoomInClick = () => {
    this._viewer.zoomIn();
  };

  private onZoomFitViewerClick = () => {
    this._viewer.zoomFitViewer();
  };

  private onZoomFitPageClick = () => {
    this._viewer.zoomFitPage();
  };
  //#endregion

  //#region page rotation
  private onRotateCounterClockwiseClick = () => {
    this.rotateCounterClockwise();
  };

  private onRotateClockwiseClick = () => {
    this.rotateClockwise();
  };

  private rotateCounterClockwise() {
    if (!this._docService) {
      return;
    }
    this._pageService.getCurrentPage().rotateCounterClockwise();
    this.setAnnotationMode(this._annotatorService.mode);
  }

  private rotateClockwise() {
    if (!this._docService) {
      return;
    }
    this._pageService.getCurrentPage().rotateCounterClockwise();
    this.setAnnotationMode(this._annotatorService.mode);
  }
  //#endregion

  //#region paginator
  private onPaginatorInput = (event: Event) => {
    if (event.target instanceof HTMLInputElement) {
      event.target.value = event.target.value.replace(/[^\d]+/g, "");
    }
  };

  private onPaginatorChange = (event: Event) => {
    if (event.target instanceof HTMLInputElement) {
      const pageNumber = Math.max(Math.min(+event.target.value, this._docManagerService.pageCount), 1);
      if (pageNumber + "" !== event.target.value) {
        event.target.value = pageNumber + "";
      }
      this._pageService.requestSetCurrentPageIndex(pageNumber - 1);
    }
  };

  private onPaginatorPrevClick = () => {
    this.moveToPrevPage();
  };

  private onPaginatorNextClick = () => {
    this.moveToNextPage();
  };

  private onCurrentPagesChanged = (event: CurrentPageChangeEvent) => {
    const { newIndex } = event.detail;
    (<HTMLInputElement>this._shadowRoot.getElementById("paginator-input")).value = newIndex + 1 + "";
  };

  private moveToPrevPage() {
    if (!this._docService) {
      return;
    }
    const pageIndex = clamp(this._pageService.currentPageIndex - 1, 0, this._pageService.length - 1);
    this._pageService.requestSetCurrentPageIndex(pageIndex);
  }

  private moveToNextPage() {
    if (!this._docService) {
      return;
    }
    const pageIndex = clamp(this._pageService.currentPageIndex + 1, 0, this._pageService.length - 1);
    this._pageService.requestSetCurrentPageIndex(pageIndex);
  }
  //#endregion

  //#region annotations
  private annotatorUndo = () => {
    this._annotatorService.annotator?.undo();
  };

  private annotatorClear = () => {
    this._annotatorService.annotator?.clear();
  };

  private annotatorSave = () => {
    this._annotatorService.annotator?.saveAnnotationAsync();
  };

  private annotatorOptions = () => {
    // console.log("annotatorOptions this._viewer",this._viewer);
    // var ev = document.createEvent('HTMLEvents');
    // ev.clientX = containerWidth;
    // ev.clientY = 100;
    // ev.initEvent('contextmenu', true, false);
    const customEvent = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: (this._viewer.container.clientWidth), // Specify the X coordinate
      clientY: (this._viewer.container.clientHeight/2)  // Specify the Y coordinate
    });
    this._viewer.container.dispatchEvent(customEvent);
  };

  private onCustomStampChanged = (e: CustomStampEvent) => {
    this.setAnnotationMode("stamp");

    // execute change callback if present
    if (this._customStampChangeCallback) {
      this._customStampChangeCallback(e.detail);
    }
  };

  private onAnnotationChange = (e: AnnotEvent) => {
    if (!e.detail) {
      return;
    }

    const annotations = e.detail.annotations;
    switch (e.detail.type) {
      case "focus":
        if (annotations?.length) {
          this._mainContainer.classList.add("annotation-focused");
        } else {
          this._mainContainer.classList.remove("annotation-focused");
        }
        const annotation = annotations[0];
        if (annotation) {
          (<HTMLParagraphElement>this._shadowRoot.querySelector("#focused-annotation-author"))
            .textContent = annotation.author || "";
          (<HTMLParagraphElement>this._shadowRoot.querySelector("#focused-annotation-date"))
            .textContent = new Date(annotation.dateModified || annotation.dateCreated).toDateString();
          (<HTMLParagraphElement>this._shadowRoot.querySelector("#focused-annotation-text"))
            .textContent = annotation.textContent || "";
        } else {
          (<HTMLParagraphElement>this._shadowRoot.querySelector("#focused-annotation-author"))
            .textContent = "";
          (<HTMLParagraphElement>this._shadowRoot.querySelector("#focused-annotation-date"))
            .textContent = "";
          (<HTMLParagraphElement>this._shadowRoot.querySelector("#focused-annotation-text"))
            .textContent = "";
        }
        break;
      case "select":
        if (annotations?.length) {
          this._mainContainer.classList.add("annotation-selected");
          this._mainContainer.classList.add("annotation-focused"); // for touch devices
        } else {
          this._mainContainer.classList.remove("annotation-selected");
          this._mainContainer.classList.remove("annotation-focused"); // for touch devices
        }
        break;
      case "add":
      case "delete":
      case "render":
      case "import":
        // rerender affected pages
        if (annotations?.length) {
          const pageIdSet = new Set<number>(annotations.map(x => x.pageId));
          this._pageService.renderSpecifiedPages(pageIdSet);
        }
        break;
      case "edit":
        // there is no need to rerender page on edit 
        // because the annotation render may be still in process.
        // so just wait for the 'render' event
        break;
    }

    // execute change callback if present
    if (this._annotChangeCallback) {
      this._annotChangeCallback(e.detail);
    }
  };

  private onAnnotatorDataChanged = (event: AnnotatorDataChangeEvent) => {
    annotatorTypes.forEach(x => {
      this._mainContainer.classList.remove(x + "-annotator-data-saveable");
      this._mainContainer.classList.remove(x + "-annotator-data-undoable");
      this._mainContainer.classList.remove(x + "-annotator-data-clearable");
    });

    if (event.detail.saveable) {
      this._mainContainer.classList.add(event.detail.annotatorType + "-annotator-data-saveable");
    }
    if (event.detail.undoable) {
      this._mainContainer.classList.add(event.detail.annotatorType + "-annotator-data-undoable");
    }
    if (event.detail.clearable) {
      this._mainContainer.classList.add(event.detail.annotatorType + "-annotator-data-clearable");
    }
  };

  private setAnnotationMode(mode: AnnotatorServiceMode) {
    if (!this._annotatorService || !mode) {
      return;
    }
    console.log("setAnnotationMode: ", mode);
    const prevMode = this._annotatorService.mode;
    this._shadowRoot.querySelector(`#button-annotation-mode-${prevMode}`)?.classList.remove("on");
    this._shadowRoot.querySelector(`#button-annotation-mode-${mode}`)?.classList.add("on");

    const menus = this._shadowRoot.querySelectorAll('.button-annotation-options');
    console.log(menus);
    menus.forEach(menu => {
      (menu as HTMLElement)?.classList.remove("button-annotation-options-show")
    });
    const options = this._shadowRoot.querySelector(`#button-annotation-${mode}-options`);
    console.log(options);
    if (options) {
      (options as HTMLElement)?.classList.add("button-annotation-options-show")
    }
    
    // const currentPage = this._pageService.getCurrentPage();
    // console.log("currentPage",currentPage);
    // if(currentPage?.index == 0){
    //   this._pageService.requestSetCurrentPageIndex(currentPage?.index+1);
    //   setTimeout(() => {this._pageService.requestSetCurrentPageIndex(currentPage?.index)}, 800);
    // }
    this._annotatorService.mode = mode;
  }

  private onAnnotationEditTextButtonClick = async () => {
    const initialText = this._docService?.getSelectedAnnotationTextContent();
    const text = await this._viewer.showTextDialogAsync(initialText);
    if (text === null) {
      return;
    }
    await this._docService?.setSelectedAnnotationTextContentAsync(text);
  };

  private onAnnotationDeleteButtonClick = () => {
    this._docService?.removeSelectedAnnotation();
  };

  private onAnnotationModeButtonClick = (e: Event) => {
    const parentButton = (<Element>e.target).closest("*[id^=\"button-annotation-mode-\"]");
    if (!parentButton) {
      return;
    }
    const mode = /button-annotation-mode-(.+)/.exec(parentButton.id)[1] as AnnotatorServiceMode;
    this.setAnnotationMode(mode);
  };
  //#endregion

  //#region show/hide panels
  private onMainContainerPointerMove = (event: PointerEvent) => {
    const { clientX, clientY } = event;
    const { x: rectX, y: rectY, width, height } = this._mainContainer.getBoundingClientRect();

    const l = clientX - rectX;
    const t = clientY - rectY;
    const r = width - l;
    const b = height - t;

    if (Math.min(l, r, t, b) > 150) {
      // hide panels if pointer is far from the container edges
      this.hidePanels();
    } else {
      // show panels otherwise
      this.showPanels();
    }
  };

  private hidePanels() {
    if (!this._panelsHidden && !this._timers.hidePanels) {
      this._timers.hidePanels = setTimeout(() => {
        if (!this._docManagerService?.docLoaded) {
          return; // hide panels only if document is open
        }
        this._mainContainer.classList.add("hide-panels");
        this._panelsHidden = true;
        this._timers.hidePanels = null;
      }, 5000);
    }
  }

  private showPanels() {
    if (this._timers.hidePanels) {
      clearTimeout(this._timers.hidePanels);
      this._timers.hidePanels = null;
    }
    if (this._panelsHidden) {
      this._mainContainer.classList.remove("hide-panels");
      this._panelsHidden = false;
    }
  }
  //#endregion

  //#region misc
  private onPdfLoadingProgress = (progressData: { loaded: number; total: number }) => {
    // TODO: implement progress display
  };

  private docServiceUndo = () => {
    this._docService?.undoAsync();
  };

  private onDocChangeAsync = async (e: DocChangeEvent) => {
    if (e.detail.type === "main") {
      if (e.detail.action === "open") {
        this.setMode();

        // load pages from the document
        await this.refreshPagesAsync();

        // create an annotation builder and set its mode to 'select'
        this._annotatorService = new AnnotatorService(this._docService,
          this._pageService, this._customStampsService, this._viewer);
        this.setAnnotationMode("select");

        this._mainContainer.classList.remove("disabled");
      } else if (e.detail.action === "close") {
        this._mainContainer.classList.add("disabled");
        // remove unneeded classes from the main container
        this._mainContainer.classList.remove("annotation-focused");
        this._mainContainer.classList.remove("annotation-selected");

        // reset viewer state to default
        this.setMode();

        this._annotatorService?.destroy();

        await this.refreshPagesAsync();
        this.showPanels();
      }
    }
    if (e.detail.type === "compared") {
      if (e.detail.action === "open") {
        this._mainContainer.classList.add("comparison-loaded");
      } else if (e.detail.action === "close") {
        this._mainContainer.classList.remove("comparison-loaded");
      }
      if (this._modeService.mode === "comparison") {
        // force rerender pages
        this._viewer.renderVisible(true);
      }
    }
  };

  private onDocServiceStateChange = (e: DocServiceStateChangeEvent) => {
    if (e.detail.undoableCount) {
      this._mainContainer.classList.add("undoable-commands");
    } else {
      this._mainContainer.classList.remove("undoable-commands");
    }
  };

  /**
   * refresh the loaded pdf file page views and previews
   * @returns 
   */
  private async refreshPagesAsync(): Promise<void> {
    const docPagesNumber = this._docManagerService.pageCount;
    this._shadowRoot.getElementById("paginator-total").innerHTML = docPagesNumber + "";

    await this._pageService.reloadPagesAsync();
  }

  private onPreviewerToggleClick = () => {
    this.togglePreviewer();
  };

  private togglePreviewer() {
    if (this._previewer.hidden) {
      this._mainContainer.classList.remove("hide-previewer");
      this._shadowRoot.querySelector("div#toggle-previewer").classList.add("on");
      this._previewer.show();
    } else {
      this._mainContainer.classList.add("hide-previewer");
      this._shadowRoot.querySelector("div#toggle-previewer").classList.remove("on");
      this._previewer.hide();
    }
  }

  private showPasswordDialogAsync = async (): Promise<string> => {
    const passwordPromise = new Promise<string>((resolve, reject) => {

      const dialog = DomUtils.htmlToElements(passwordDialogHtml)[0];
      this._mainContainer.append(dialog);

      let value = "";
      const input = dialog.querySelector(".password-input") as HTMLInputElement;
      input.placeholder = "Enter password...";
      input.addEventListener("change", () => value = input.value);

      const ok = () => {
        dialog.remove();
        resolve(value);
      };
      const cancel = () => {
        dialog.remove();
        resolve(null);
      };

      dialog.addEventListener("click", (e: Event) => {
        if (e.target === dialog) {
          cancel();
        }
      });

      dialog.querySelector(".password-ok").addEventListener("click", ok);
      dialog.querySelector(".password-cancel").addEventListener("click", cancel);
    });

    return passwordPromise;
  };

  private onViewerKeyDown = (event: KeyboardEvent) => {
    switch (event.code) {
      case "KeyO":
        if (event.ctrlKey && event.altKey) {
          event.preventDefault();
          if (this._fileButtons.includes("open")) {
            if (this._fileOpenAction) {
              this._fileOpenAction();
            } else if (this.onOpenFileButtonClick) {
              this.onOpenFileButtonClick();
            }
          }
        }
        break;
      case "KeyS":
        if (this._docService && event.ctrlKey && event.altKey) {
          event.preventDefault();
          if (this._fileButtons.includes("save")) {
            if (this._fileSaveAction) {
              this._fileSaveAction();
            } else if (this.onSaveFileButtonClickAsync) {
              this.onSaveFileButtonClickAsync();
            }
          }
        }
        break;
      case "KeyX":
        if (this._docService && event.ctrlKey && event.altKey) {
          event.preventDefault();
          if (this._fileButtons.includes("close")) {
            if (this._fileCloseAction) {
              this._fileCloseAction();
            } else if (this.onCloseFileButtonClick) {
              this.onCloseFileButtonClick();
            }
          }
        }
        break;
      case "KeyT":
        if (this._docService && event.ctrlKey && event.altKey) {
          event.preventDefault();
          this.togglePreviewer();
        }
        break;
      case "Digit1":
        if (this._docService && event.ctrlKey && event.altKey) {
          event.preventDefault();
          this.setMode("text");
        }
        break;
      case "Digit2":
        if (this._docService && event.ctrlKey && event.altKey) {
          event.preventDefault();
          this.setMode("hand");
        }
        break;
      case "Digit3":
        if (this._docService && event.ctrlKey && event.altKey) {
          event.preventDefault();
          this.setMode("annotation");
        }
        break;
      case "Digit4":
        if (this._docService && event.ctrlKey && event.altKey) {
          event.preventDefault();
          this.setMode("comparison");
        }
        break;
      case "ArrowLeft":
        event.preventDefault();
        this.moveToPrevPage();
        break;
      case "ArrowRight":
        event.preventDefault();
        this.moveToNextPage();
        break;
      case "ArrowUp":
        event.preventDefault();
        this._viewer.zoomIn();
        break;
      case "ArrowDown":
        event.preventDefault();
        this._viewer.zoomOut();
        break;
      case "Comma":
        event.preventDefault();
        this.rotateCounterClockwise();
        break;
      case "Period":
        event.preventDefault();
        this.rotateClockwise();
        break;
      case "Escape":
        event.preventDefault();
        this._annotatorService.annotator?.clear();
        break;
      case "Backspace":
        event.preventDefault();
        this._annotatorService.annotator?.undo();
        break;
      case "Enter":
        event.preventDefault();
        this._annotatorService.annotator?.saveAnnotationAsync();
        break;
      case "KeyZ":
        if (event.ctrlKey) {
          event.preventDefault();
          this._docService?.undoAsync();
        }
        break;
      default:
        return;
    }
  };
  //#endregion
}

export {
  AnnotationDto, AnnotEvent, AnnotEventDetail,
  CustomStampCreationInfo, CustomStampEventDetail, ViewerMode as TsPdfViewerMode
};
