/*
Copyright 2016, 2018, 2021 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

// Pull in the encryption lib so that we can decrypt attachments.
import encrypt from 'browser-encrypt-attachment';
import { decodeBase64 } from 'matrix-js-sdk/src/crypto/olmlib';
import { mediaFromContent } from "../customisations/Media";
import { IEncryptedFile, IMediaEventInfo } from "../customisations/models/IMediaEventContent";
import { getBlobSafeMimeType } from "./blobs";
import { sanitizeSvg } from './FileUtils';

/**
 * Decrypt a file attached to a matrix event.
 * @param {IEncryptedFile} file The encrypted file information taken from the matrix event.
 *   This passed to [link]{@link https://github.com/matrix-org/browser-encrypt-attachment}
 *   as an encryption info object, so it will also have those keys in addition to
 *   the keys below.
 * @param {IMediaEventInfo} info The info parameter taken from the matrix event.
 * @param {boolean} isSvgThumbnail Whether file is a encrypted svg used for thumbnails.
 * @returns {Promise<Blob>} Resolves to a Blob of the file.
 */
export function decryptFile(
    file: IEncryptedFile,
    info?: IMediaEventInfo,
    isSvgThumbnail = false,
): Promise<Blob> {
    const media = mediaFromContent({ file });
    // Download the encrypted file as an array buffer.
    return media.downloadSource().then((response) => {
        return response.arrayBuffer();
    }).then((responseData) => {
        // Decrypt the array buffer using the information taken from
        // the event content.
        return encrypt.decryptAttachment(responseData, file);
    }).then((dataArray) => {
        // Turn the array into a Blob and give it the correct MIME-type.
        //
        // IMPORTANT: we must not allow scriptable MIME-types into Blobs otherwise
        // they introduce XSS attacks if the Blob URI is viewed directly in the
        // browser (e.g. by copying the URI into a new tab or window).
        // However, image/svg+xml can be allowed, since files of this type can be
        // sanitized using DOMPurify.
        // For more information refer to the comment in blobs.ts.
        let mimetype = info?.mimetype ? info.mimetype.split(";")[0].trim() : '';
        mimetype = getBlobSafeMimeType(mimetype);

        // In case of svg thumbnails we generate we create a sanitized Blob.
        // NOTE: For SVG we can also use the thumbnail for the lightbox.
        if (mimetype === "image/svg+xml" && isSvgThumbnail) {
            const svgFile = new TextDecoder("utf-8").decode(decodeBase64(dataArray));
            return new Blob([sanitizeSvg(svgFile)], { type: mimetype });
        }

        return new Blob([dataArray], { type: mimetype });
    });
}
