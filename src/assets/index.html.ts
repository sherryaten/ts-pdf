/// <reference path="./assets.d.ts" />

import { Icons } from "ts-viewers-core";
var icon_options = "data:image/png;base64,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"
const icon_bookmark = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzODQgNTEyIj48IS0tIUZvbnQgQXdlc29tZSBQcm8gNi42LjAgYnkgQGZvbnRhd2Vzb21lIC0gaHR0cHM6Ly9mb250YXdlc29tZS5jb20gTGljZW5zZSAtIGh0dHBzOi8vZm9udGF3ZXNvbWUuY29tL2xpY2Vuc2UgKENvbW1lcmNpYWwgTGljZW5zZSkgQ29weXJpZ2h0IDIwMjQgRm9udGljb25zLCBJbmMuLS0+PHBhdGggZD0iTTAgNDhDMCAyMS41IDIxLjUgMCA0OCAwTDMzNiAwYzI2LjUgMCA0OCAyMS41IDQ4IDQ4bDAgNDQxLjljMCAxMi4yLTkuOSAyMi4xLTIyLjEgMjIuMWMtNC40IDAtOC42LTEuMy0xMi4zLTMuN0wxOTIgNDAzLjIgMzQuNCA1MDguM2MtMy42IDIuNC03LjkgMy43LTEyLjMgMy43QzkuOSA1MTIgMCA1MDIuMSAwIDQ4OS45TDAgNDh6TTQ4IDMyYy04LjggMC0xNiA3LjItMTYgMTZsMCA0MjMuNEwxODMuMSAzNzAuN2M1LjQtMy42IDEyLjQtMy42IDE3LjggMEwzNTIgNDcxLjQgMzUyIDQ4YzAtOC44LTcuMi0xNi0xNi0xNkw0OCAzMnoiLz48L3N2Zz4="
const icon_save = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0NDggNTEyIj48IS0tIUZvbnQgQXdlc29tZSBQcm8gNi42LjAgYnkgQGZvbnRhd2Vzb21lIC0gaHR0cHM6Ly9mb250YXdlc29tZS5jb20gTGljZW5zZSAtIGh0dHBzOi8vZm9udGF3ZXNvbWUuY29tL2xpY2Vuc2UgKENvbW1lcmNpYWwgTGljZW5zZSkgQ29weXJpZ2h0IDIwMjQgRm9udGljb25zLCBJbmMuLS0+PHBhdGggZD0iTTMyIDk2YzAtMTcuNyAxNC4zLTMyIDMyLTMybDAgOTZjMCAxNy43IDE0LjMgMzIgMzIgMzJsMTkyIDBjMTcuNyAwIDMyLTE0LjMgMzItMzJsMC05NC4yYzQuNSAxLjYgOC43IDQuMiAxMi4xIDcuNmw3NC41IDc0LjVjNiA2IDkuNCAxNC4xIDkuNCAyMi42TDQxNiA0MTZjMCAxNy43LTE0LjMgMzItMzIgMzJMNjQgNDQ4Yy0xNy43IDAtMzItMTQuMy0zMi0zMkwzMiA5NnpNOTYgNjRsMTkyIDAgMCA5Nkw5NiAxNjBsMC05NnpNMCA5NkwwIDQxNmMwIDM1LjMgMjguNyA2NCA2NCA2NGwzMjAgMGMzNS4zIDAgNjQtMjguNyA2NC02NGwwLTI0NS41YzAtMTctNi43LTMzLjMtMTguNy00NS4zTDM1NC43IDUwLjdjLTEyLTEyLTI4LjMtMTguNy00NS4zLTE4LjdMNjQgMzJDMjguNyAzMiAwIDYwLjcgMCA5NnpNMjcyIDMyMGE0OCA0OCAwIDEgMSAtOTYgMCA0OCA0OCAwIDEgMSA5NiAwem0tNDgtODBhODAgODAgMCAxIDAgMCAxNjAgODAgODAgMCAxIDAgMC0xNjB6Ii8+PC9zdmc+"
const icon_bar = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0NDggNTEyIj48IS0tIUZvbnQgQXdlc29tZSBQcm8gNi42LjAgYnkgQGZvbnRhd2Vzb21lIC0gaHR0cHM6Ly9mb250YXdlc29tZS5jb20gTGljZW5zZSAtIGh0dHBzOi8vZm9udGF3ZXNvbWUuY29tL2xpY2Vuc2UgKENvbW1lcmNpYWwgTGljZW5zZSkgQ29weXJpZ2h0IDIwMjQgRm9udGljb25zLCBJbmMuLS0+PHBhdGggZD0iTTAgODBjMC04LjggNy4yLTE2IDE2LTE2bDQxNiAwYzguOCAwIDE2IDcuMiAxNiAxNnMtNy4yIDE2LTE2IDE2TDE2IDk2QzcuMiA5NiAwIDg4LjggMCA4MHpNMCAyNDBjMC04LjggNy4yLTE2IDE2LTE2bDQxNiAwYzguOCAwIDE2IDcuMiAxNiAxNnMtNy4yIDE2LTE2IDE2TDE2IDI1NmMtOC44IDAtMTYtNy4yLTE2LTE2ek00NDggNDAwYzAgOC44LTcuMiAxNi0xNiAxNkwxNiA0MTZjLTguOCAwLTE2LTcuMi0xNi0xNnM3LjItMTYgMTYtMTZsNDE2IDBjOC44IDAgMTYgNy4yIDE2IDE2eiIvPjwvc3ZnPg=="
export const mainHtml = /*html*/`
  <div id="main-container" tabindex="0" class="hide-previewer disabled" 
    ondragstart="return false;" ondrop="return false;">
    <div id="viewer"></div>
    <div id="previewer"></div>
    <div id="top-panel"> 
      <div class="subpanel panel-item">
      <div id="button-mode-list" class="panel-button panel-item">
          <img src="${icon_bar}"/>
        </div>
        <div id="toggle-previewer" class="panel-button panel-item">
          <img src="${Icons.icon_sidebar}"/>
        </div> 
      </div>
      <div id="modes" class="subpanel panel-item">
        <div id="button-mode-text" class="panel-button panel-item">
          <img src="${Icons.icon_caret}"/>
        </div> 
        <div id="button-mode-hand" class="panel-button panel-item">
          <img src="${Icons.icon_hand}"/>
        </div>
        <div id="button-mode-bookmark" class="panel-button panel-item">
          <img src="${icon_bookmark}"/>
        </div>
        <div id="button-mode-save" class="panel-button panel-item">
          <img src="${icon_save}"/>
        </div>
        <div id="button-mode-annotation" class="panel-button panel-item">
          <img src="${Icons.icon_popup}"/>
        </div> 
        <div id="button-mode-comparison" class="panel-button panel-item">
          <img src="${Icons.icon_compare}"/>
        </div> 
        <div class="panel-v-separator margin-s-5 panel-item"></div>
        <div id="button-open-file" class="panel-button panel-item">
          <img src="${Icons.icon_load}"/>
        </div> 
        <div id="button-save-file" class="panel-button panel-item">
          <img src="${Icons.icon_download}"/>
        </div> 
        <div id="button-close-file" class="panel-button panel-item">
          <img src="${Icons.icon_close2}"/>
        </div> 
      </div>
    </div>
    
    <div id="bottom-panel">
      <div id="paginator" class="subpanel panel-item">
        <div id="paginator-prev" class="panel-button">
          <img src="${Icons.icon_arrow_up}"/>
        </div>
        <div id="paginator-next" class="panel-button">
          <img src="${Icons.icon_arrow_down}"/>
        </div>
        <input id="paginator-input" type="text">
        <span>&nbsp/&nbsp</span>
        <span id="paginator-total">0</span>
      </div>
      <div class="panel-v-separator panel-item"></div>
      <div id="rotator" class="subpanel panel-item">
        <div id="rotate-counter-clockwise" class="panel-button">
          <img src="${Icons.icon_counter_clockwise}"/>
        </div>
        <div id="rotate-clockwise" class="panel-button">
          <img src="${Icons.icon_clockwise}"/>
        </div>
      </div>
      <div class="panel-v-separator panel-item"></div>
      <div id="zoomer" class="subpanel panel-item">
        <div id="zoom-out" class="panel-button">
          <img src="${Icons.icon_minus}"/>
        </div>
        <div id="zoom-in" class="panel-button">
          <img src="${Icons.icon_plus}"/>
        </div>
        <div id="zoom-fit-viewer" class="panel-button">
          <img src="${Icons.icon_fit_viewer}"/>
        </div>
        <div id="zoom-fit-page" class="panel-button">
          <img src="${Icons.icon_fit_page}"/>
        </div>
      </div>
    </div>
    <div id="command-panel">
      <div class="command-panel-row">
        <div id="button-command-comparison-close" 
          class="panel-button command-panel-subitem accent">
          <img src="${Icons.icon_close2}"/>
        </div>
        <div id="button-command-comparison-open" 
          class="panel-button command-panel-subitem accent">
          <img src="${Icons.icon_load}"/>
        </div>
        <div id="button-command-undo" 
          class="panel-button command-panel-subitem accent">
          <img src="${Icons.icon_back}"/>
        </div>
      </div>      
    </div>
    <div id="annotation-panel">
      <div class="annotation-panel-row">
        <div id="button-annotation-edit-text" 
          class="panel-button annotation-panel-subitem">
          <img src="${Icons.icon_text}"/>
        </div> 
        <div id="button-annotation-delete" 
          class="panel-button annotation-panel-subitem">
          <img src="${Icons.icon_close}"/>
        </div> 
        <div id="button-annotation-mode-select" 
          class="panel-button annotation-panel-item">
          <img src="${Icons.icon_pointer}"/>
        </div> 
      </div>
     
      <div class="annotation-panel-row">
        <div id="button-annotation-pen-undo" 
          class="panel-button annotation-panel-subitem button-annotation-undo">
          <img src="${Icons.icon_back}"/>
        </div> 
        <div id="button-annotation-pen-clear" 
          class="panel-button annotation-panel-subitem button-annotation-clear">
          <img src="${Icons.icon_close}"/>
        </div> 
        <div id="button-annotation-pen-save" 
          class="panel-button annotation-panel-subitem button-annotation-save">
          <img src="${Icons.icon_ok}"/>
        </div> 
        <div id="button-annotation-pen-options" 
          class="panel-button annotation-panel-subitem button-annotation-options" >
          <img src="${icon_options}"/>
        </div> 
        <div id="button-annotation-mode-pen" 
          class="panel-button annotation-panel-item">
          <img src="${Icons.icon_pen}"/>
        </div> 
      </div>
      <div class="annotation-panel-row">
        <div id="button-annotation-geometric-undo" 
          class="panel-button annotation-panel-subitem button-annotation-undo">
          <img src="${Icons.icon_back}"/>
        </div> 
        <div id="button-annotation-geometric-clear" 
          class="panel-button annotation-panel-subitem button-annotation-clear">
          <img src="${Icons.icon_close}"/>
        </div> 
        <div id="button-annotation-geometric-save" 
          class="panel-button annotation-panel-subitem button-annotation-save">
          <img src="${Icons.icon_ok}"/>
        </div> 
        <div id="button-annotation-geometric-options" 
          class="panel-button annotation-panel-subitem button-annotation-options" >
          <img src="${icon_options}"/>
        </div> 
        <div id="button-annotation-mode-geometric" 
          class="panel-button annotation-panel-item">
          <img src="${Icons.icon_geometric}"/>
        </div>
      </div>
      <div class="annotation-panel-row">
        <div id="button-annotation-text-undo" 
          class="panel-button annotation-panel-subitem button-annotation-undo">
          <img src="${Icons.icon_back}"/>
        </div> 
        <div id="button-annotation-text-clear" 
          class="panel-button annotation-panel-subitem button-annotation-clear">
          <img src="${Icons.icon_close}"/>
        </div> 
        <div id="button-annotation-text-save" 
          class="panel-button annotation-panel-subitem button-annotation-save">
          <img src="${Icons.icon_ok}"/>
        </div> 
        <div id="button-annotation-text-options" 
          class="panel-button annotation-panel-subitem button-annotation-options" >
          <img src="${icon_options}"/>
        </div> 
        <div id="button-annotation-mode-text" 
          class="panel-button annotation-panel-item">
          <img src="${Icons.icon_text2}"/>
        </div>
      </div>
       <div class="annotation-panel-row">
        <div id="button-annotation-stamp-undo" 
          class="panel-button annotation-panel-subitem button-annotation-undo">
          <img src="${Icons.icon_back}"/>
        </div> 
        <div id="button-annotation-stamp-clear" 
          class="panel-button annotation-panel-subitem button-annotation-clear">
          <img src="${Icons.icon_close}"/>
        </div>
        <div id="button-annotation-stamp-save" 
          class="panel-button annotation-panel-subitem button-annotation-save">
          <img src="${Icons.icon_ok}"/>
        </div> 
         <div id="button-annotation-stamp-options" 
          class="panel-button annotation-panel-subitem button-annotation-options" >
          <img src="${icon_options}"/>
        </div> 
        <div id="button-annotation-mode-stamp" 
          class="panel-button annotation-panel-item">
          <img src="${Icons.icon_stamp}"/>
        </div> 
      </div>  
    </div>

    <div id="focused-annotation-panel">
      <p id="focused-annotation-author" class="line-clamp"></p>
      <p id="focused-annotation-date" class="line-clamp"></p>
      <p id="focused-annotation-text" class="line-clamp"></p>
    </div>

    <input id="open-file-input" class="abs-hidden" type="file" accept="application/pdf">
    <input id="open-comparable-file-input" class="abs-hidden" type="file" accept="application/pdf">
  </div>
`;

export const passwordDialogHtml =  /*html*/`
  <div class="abs-full-size-overlay password-dialog">
    <div class="form">
      <input class="password-input" type="password" maxlength="127"/>
      <div class="buttons">
        <div class="panel-button password-ok">
          <img src="${Icons.icon_ok}"/>
        </div>
        <div class="panel-button password-cancel">
          <img src="${Icons.icon_close}"/>
        </div>
      </div>
    </div>
  </div>
`;
