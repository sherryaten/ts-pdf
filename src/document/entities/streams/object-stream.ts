import { ObjectType, objectTypes, streamTypes } from "../../spec-constants";
import { CryptInfo } from "../../encryption/interfaces";
import { ParserBounds, DataParser, ParserResult } from "../../data-parse/data-parser";
import { ParserInfo } from "../../data-parse/parser-info";
import { HexString } from "../strings/hex-string";
import { LiteralString } from "../strings/literal-string";
import { ObjectId } from "../core/object-id";
import { PdfStream } from "../core/pdf-stream";

export class ObjectStream extends PdfStream {
  /**
   * (Required) The number of indirect objects stored in the stream
   */
  N: number;
  /**
   * (Required) The byte offset in the decoded stream of the first compressed object
   */
  First: number;
  /**
   * (Optional) A reference to another object stream, 
   * of which the current object stream shall be considered an extension
   */
  Extends: ObjectId;

  constructor() {
    super(streamTypes.OBJECT_STREAM);
  }  
  
  static async parseAsync(parseInfo: ParserInfo): Promise<ParserResult<ObjectStream>> { 
    if (!parseInfo) {
      throw new Error("Parsing information not passed");
    }
    try {
      const pdfObject = new ObjectStream();
      await pdfObject.parsePropsAsync(parseInfo);
      return {value: pdfObject, start: parseInfo.bounds.start, end: parseInfo.bounds.end};
    } catch (e) {
      //console.log(e.message);
      return null;
    }
  }

  async getObjectDataAsync(id: number): Promise<ParserInfo> {
    if (!this._streamData || !this.N || !this.First) {
      return null;
    }

    const parser = await this.getStreamDataParserAsync();

    const offsetMap = new Map<number, number>();
    let temp: ParserResult<number>;
    let objectId: number;
    let byteOffset: number;
    let position = 0;
    for (let n = 0; n < this.N; n++) {
      temp = await parser.parseNumberAtAsync(position, false, false);
      objectId = temp.value;
      position = temp.end + 2;    

      temp = await parser.parseNumberAtAsync(position, false, false);
      byteOffset = temp.value;
      position = temp.end + 2; 
      
      offsetMap.set(objectId, byteOffset);
    }

    if (!offsetMap.has(id)) {
      return null;
    }

    const objectStart = this.First + offsetMap.get(id);

    const objectType = await parser.getValueTypeAtAsync(objectStart);
    if (objectType === null) {
      return;
    }

    let bounds: ParserBounds;
    let value: any;
    switch (objectType) {
      case objectTypes.DICTIONARY:
        bounds = await parser.getDictBoundsAtAsync(objectStart, false);
        break;
      case objectTypes.ARRAY:
        bounds = await parser.getArrayBoundsAtAsync(objectStart, false);
        break;
      case objectTypes.STRING_LITERAL: 
        const literalValue = await LiteralString.parseAsync(parser, objectStart);
        if (literalValue) {
          bounds = {start: literalValue.start, end: literalValue.end};
          value = literalValue;
        }
        break; 
      case objectTypes.STRING_HEX: 
        const hexValue = await HexString.parseAsync(parser, objectStart);
        if (hexValue) {
          bounds = {start: hexValue.start, end: hexValue.end};
          value = hexValue;
        }
        break; 
      case objectTypes.NUMBER:
        const numValue = await parser.parseNumberAtAsync(objectStart);
        if (numValue) {
          bounds = {start: numValue.start, end: numValue.end};
          value = numValue;
        }
        break; 
      default:
        // TODO: handle remaining cases
        break;
    }
    
    if (!bounds) {
      return null;
    }    

    const bytes = await parser.sliceCharCodesAsync(bounds.start, bounds.end);
    if (!bytes.length) {
      // execution should not get here
      throw new Error("Object byte array is empty");
    }

    return {
      parser: await PdfStream.getDataParserAsync(bytes),
      bounds: {
        start: 0, 
        end: bytes.length - 1,
        contentStart: bounds.contentStart 
          ? bounds.contentStart - bounds.start 
          : undefined,
        contentEnd: bounds.contentEnd 
          ? bytes.length - 1 - (bounds.end - bounds.contentEnd) 
          : undefined,
      },
      type: <ObjectType>objectType,
      value,
      cryptInfo: {ref: {id, generation: 0}},
      streamId: this.id,
    };
  }

  override toArray(cryptInfo?: CryptInfo): Uint8Array {
    const superBytes = super.toArray(cryptInfo);  
    const encoder = new TextEncoder();  
    const bytes: number[] = [];  

    if (this.N) {
      bytes.push(...encoder.encode("/N "), ...encoder.encode(" " + this.N));
    }
    if (this.First) {
      bytes.push(...encoder.encode("/First "), ...encoder.encode(" " + this.First));
    }
    if (this.Extends) {
      bytes.push(...encoder.encode("/Extends "), ...this.Extends.toArray(cryptInfo));
    }

    const totalBytes: number[] = [
      ...superBytes.subarray(0, 2), // <<
      ...bytes, 
      ...superBytes.subarray(2, superBytes.length)];
    return new Uint8Array(totalBytes);
  }

  /**
   * fill public properties from data using info/parser if available
   */
  protected override async parsePropsAsync(parseInfo: ParserInfo) {
    await super.parsePropsAsync(parseInfo);
    const {parser, bounds} = parseInfo;
    const start = bounds.contentStart || bounds.start;
    const dictBounds = await parser.getDictBoundsAtAsync(start);
    
    let i = await parser.skipToNextNameAsync(dictBounds.contentStart, dictBounds.contentEnd);
    let name: string;
    let parseResult: ParserResult<string>;
    while (true) {
      parseResult = await parser.parseNameAtAsync(i);
      if (parseResult) {
        i = parseResult.end + 1;
        name = parseResult.value;
        switch (name) {
          case "/N":
          case "/First":
            i = await this.parseNumberPropAsync(name, parser, i, false);
            break;

          case "/Extends":
            i = await this.parseRefPropAsync(name, parser, i);
            break;

          default:
            // skip to next name
            i = await parser.skipToNextNameAsync(i, dictBounds.contentEnd);
            break;
        }
      } else {
        break;
      }
    };
  }
}
