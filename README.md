# ts-pdf 📄
<p align="left">
    <a href="https://www.npmjs.com/package/ts-pdf">
      <img src="https://img.shields.io/npm/v/ts-pdf" alt="Npm">
    </a>
    <a href="https://github.com/yermolim/ts-pdf/blob/master/LICENSE">
      <img src="https://img.shields.io/badge/license-AGPL-blue.svg?style=flat-round" alt="License">
    </a>
    <br>
</p>
A PDF.js-based PDF viewer written in TypeScript.

## Features
<ul>
    <li>opening and viewing PDF files</li>
    <li>comparing two PDF files and visualizing differences</li>
    <li>adding and editing PDF annotations (supported annotation types are listed below)</li>
    <li>custom parsing and rendering for the supported annotation types</li>
    <li>annotation import/export to/from data-transfer objects that can be effortlessly serialized to JSON (useful for storing annotations in the separate database)</li>
    <li>compliance to the official PDF specification (v1.7)</li>
    <li>encrypted PDF-files support (supported encryption algorithms are listed below)</li>
    <li>responsive UI, friendly for touch devices</li>
    <li>easy color scheme customization using CSS variables to override the default values</li>
    <li>using Shadow DOM to minimize conflicts with outer HTML</li>
    <li>page and annotation parsing is run in background threads using web workers to minimize interface lags</li>
</ul>

<img src="https://raw.githubusercontent.com/yermolim/ts-pdf/main/gifs/main.gif" width="540" height="340">
<p float="left">
  <img src="https://raw.githubusercontent.com/yermolim/ts-pdf/main/gifs/mobile.gif" 
  width="180" height="320">
  <img src="https://raw.githubusercontent.com/yermolim/ts-pdf/main/gifs/mobile-annots.gif" width="180" height="320">
  <img src="https://raw.githubusercontent.com/yermolim/ts-pdf/main/gifs/text.gif" width="180" height="320">
</p>

## How it works in a nutshell
PDF file source data (decrypted if needed) is parsed using the custom parser written from scratch. 
Annotations of all the supported types are extracted from the source file. 
The resulting PDF file (without the supported annotations) is handled by the PDF.js worker, which is used to render the file contents and build a text layer. 
The extracted annotations are rendered to SVG on top of the pages by the custom PDF appearance stream renderer. 
User can modify or delete any supported annotation or add new annotations of the supported types by using provided UI. The annotations can be imported or exported at any time using corresponding methods. 
All changes are made can be saved to a new PDF file, which can be downloaded or returned to the caller as a byte array.

### Currently supported annotation types
<ul>
    <li>Ink annotation</li>
    <li>Stamp annotation</li>
    <li>Line annotation</li>
    <li>Square annotation</li>
    <li>Circle annotation</li>
    <li>Polygon annotation</li>
    <li>Polyline annotation</li>
    <li>Highlight annotation</li>
    <li>Underline annotation</li>
    <li>Squiggly annotation</li>
    <li>Strikeout annotation</li>
    <li>Text annotation (only note icon)</li>
    <li>Free text annotation</li>
</ul>

### Currently supported PDF encryption algorithms
<ul>
    <li>V1R2 (RC4 with 40-bit key)</li>
    <li>V2R3 (RC4 with 128-bit key)</li>
    <li>V4R4 (RC4 or AES with 128-bit key)</li>
</ul>

#### Yet to be implemented
<ul>
    <li>V5R5 (AES with 256-bit key)</li>
    <li>V5R6 (AES with 256-bit key, PDF 2.0)</li>
</ul>

### Currently supported PDF stream encoding algorithms
<ul>
    <li>Flate</li>
    <li>DCT</li>
    <li>JBIG2</li>
    <li>JPX</li>
</ul>

#### Not implemented yet
<ul>
    <li>LZW</li>
    <li>ASCII base-85</li>
    <li>ASCII hexadecimal</li>
    <li>CCITT</li>
    <li>Run-length</li>
</ul>


## Getting started

### Installation into your project
```
npm install ts-pdf
```

### Running the simplest example
```javascript
import { TsPdfViewer, TsPdfViewerOptions } from "ts-pdf";

async function run(): Promise<void> {  
  const options: TsPdfViewerOptions = {
    containerSelector: "#your-html-container-selector", 
    workerSource: "assets/pdf.worker.min.mjs", // path to the PDF.js worker script
    userName: "your_username",
    // you can check other properties using your editor hints
  };
  const viewer = new TsPdfViewer(options);
  await viewer.openPdfAsync("your_file.pdf");
} 

run();
```

#### ⚠️for viewer to function properly its container element must have relative, absolute or fixed position!
#### ⚠️the PDF.js worker version must match the version of the pdfjs-dist module. When you have the module installed, you can find the default worker file in your node_modules folder: './node_modules/pdfjs-dist/build/pdf.worker.min.mjs'.

### Changing the color scheme

To apply a custom color scheme to the viewer, assign color values to the following CSS variables. Default values are used for omitted variables.
```css
:root {
  --tspdf-color-primary: rgba(77, 88, 115, 1);
  --tspdf-color-primary-tr: rgba(77, 88, 115, 0.9);
  --tspdf-color-secondary: rgb(113, 133, 150);
  --tspdf-color-secondary-tr: rgba(113, 133, 150, 0.9);
  --tspdf-color-accent: rgba(64, 72, 95, 1);
  --tspdf-color-shadow: rgba(0, 0, 0, 0.75);
  --tspdf-color-bg: rgba(128, 128, 128,1);
  --tspdf-color-fg-primary: rgba(255, 255, 255, 1);
  --tspdf-color-fg-secondary:rgba(187, 187, 187, 1);
  --tspdf-color-fg-accent: rgb(255, 204, 0);
  --tspdf-color-text-selection: rgba(104, 104, 128, 0.3);
}
```

### Keyboard shortcuts
<ul>
    <li>alt + ctrl + o => open file (if the corresponding button is allowed in options)</li>
    <li>alt + ctrl + s => save file (if the corresponding button is allowed in options)</li>
    <li>alt + ctrl + x => close file (if the corresponding button is allowed in options)</li>
    <li>alt + ctrl + t => toggle preview panel visibility</li>
    <li>alt + ctrl + 1 => text selection mode</li>
    <li>alt + ctrl + 2 => hand drag mode</li>
    <li>alt + ctrl + 3 => annotation mode</li>
    <li>alt + ctrl + 4 => comparison mode</li>
    <li>escape => clear annotation (in annotation add mode)</li>
    <li>backspace => undo last action (in annotation add mode)</li>
    <li>enter => save annotation (in annotation add mode)</li>
    <li>ctrz + z => undo last annotation edit</li>
    <li>↑ => zoom in</li>
    <li>↓ => zoom out</li>
    <li>← => previous page</li>
    <li>→ => next page</li>
    <li>&lt; => rotate left</li>
    <li>&gt; => rotate right</li>
</ul>

### Solving Angular app compilation issue

When using this module inside an Angular app you can face the problem that your project is not compiling because of 'SyntaxError: Unexpected token'. The cause of such behavior is that Angular 11.x and lower use Webpack v4.x that does not support fluent null-check syntax ('?.'), which is present in 'pdfjs-dist' build. 
The easy solution is to replace 
```json
"main": "build/pdf.js" 
```
with 
```json
"main": "es5/build/pdf.js" 
```
inside 
```
"/node_modules/pdfjs-dist/package.json"
```
The other one is to make your own build of PDF.js.


## TODO list
<ul>
    <li><del>add ink annotations support</del> added in 0.1.0</li>
    <li><del>add geometric annotations (line, polyline, polygon, square, circle) support</del> added in 0.2.0</li>
    <li><del>add text markup annotations (underline, strikeout, highlight, squiggly) support</del> added in 0.4.0</li>
    <li><del>add text annotations (note) support</del> added in 0.4.0</li>
    <li><del>add page rotation support</del> added in 0.5.0</li>
    <li><del>add annotation blending modes support</del> added in 0.5.2</li>
    <li><del>add custom stamp annotations support</del> added in 0.6.0</li>
    <li><del>optimize loading and saving files</del> some optimizations were made in 0.6.2</li>
    <li><del>add text caption support for line annotations</del> added in 0.6.6</li>
    <li><del>add free text annotations support</del> added in 0.7.0</li>
    <li><del>add 'undo' button and corresponding logic</del> added in 0.7.0</li>
    <li><del>move parser to background thread using web workers</del> added in 0.9.0</li>
    <li><del>add keyboard shortcuts</del>added in 0.10.0</li>
    <li><del>add document comparison mode</del>added in 0.11.0</li>
    <li>add tooltips to buttons</li>
    <li>add user-frienly error messages on failed file opening</li>
    <li>make error messages more informative</li>
    <li>add proper support for linearized PDF files</li>
    <li>add more options for line annotations</li>
    <li>add more options for free text annotations</li>
    <li>add watermark tool (with watermark generator)</li>
    <li>add localizations</li>
    <li>add tests</li>
    <li>limit users to editing their own annotations only (optionally)</li>
    <li>further optimization of the parser and the renderer</li>
    <li>support for PDF 2.0 features (requires purchasing the specification)</li>
    <li>support for the rest of encryption algorithms (on request only)</li>
    <li>support for the rest of encoding algorithms (on request only)</li>
</ul>

## External dependencies:
<ul>
    <li><a href="https://github.com/mozilla/pdfjs-dist">PDF.js<a></li>
    <li><a href="https://github.com/entronad/crypto-es">CryptoES<a></li>
    <li><a href="https://github.com/nodeca/pako">pako<a></li>
    <li><a href="https://github.com/uuidjs/uuid">uuid<a></li>
</ul>

## Running the demo

<ul>
    <li>Clone the repository to your local machine</li>
    <li>(optional) Change the host/port if needed in the 'ls-config.json' file</li>
    <li>Run the 'npm run start' command from the project folder</li>
    <li>Open the demo page in your web browser</li>
</ul>

#### Additional information
