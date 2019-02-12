/* Copyright 2017 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const EventEmitter = require('events');
var Canvas = require('canvas');
var assert = require('assert');
var fs = require('fs');
var pdfjsLib = require('pdfjs-dist');
var Pdfkit = require('pdfkit');
var PNGCrop = require('png-crop');


const myEE = new EventEmitter();


function NodeCanvasFactory() { }
NodeCanvasFactory.prototype = {
	create: function NodeCanvasFactory_create(width, height) {
		assert(width > 0 && height > 0, 'Invalid canvas size');
		var canvas = Canvas.createCanvas(width, height);
		var context = canvas.getContext('2d');
		return {
			canvas: canvas,
			context: context,
		};
	},

	reset: function NodeCanvasFactory_reset(canvasAndContext, width, height) {
		assert(canvasAndContext.canvas, 'Canvas is not specified');
		assert(width > 0 && height > 0, 'Invalid canvas size');
		canvasAndContext.canvas.width = width;
		canvasAndContext.canvas.height = height;
	},

	destroy: function NodeCanvasFactory_destroy(canvasAndContext) {
		assert(canvasAndContext.canvas, 'Canvas is not specified');

		// Zeroing the width and height cause Firefox to release graphics
		// resources immediately, which can greatly reduce memory consumption.
		canvasAndContext.canvas.width = 0;
		canvasAndContext.canvas.height = 0;
		canvasAndContext.canvas = null;
		canvasAndContext.context = null;
	}
};


myEE.on('load-document', data => {

	const document = `${dir}/${files[data.numDocument]}`;

	// Read the PDF file into a typed array so PDF.js can load it.
	var rawData = new Uint8Array(fs.readFileSync(document));

	var loadingTask = pdfjsLib.getDocument(rawData);
	loadingTask.promise.then(pdfDocument => {

		var numPages = pdfDocument.numPages;
		console.log(`PDF document ${files[data.numDocument]} loaded (${numPages} pages).`);

		var pageNum = 1;

		myEE.emit('parse-page', Object.assign(data, {pdfDocument, pageNum, numPages}));

	});
});

myEE.on('parse-page', data => {

	return data.pdfDocument.getPage(data.pageNum).then(function (page) {

		var viewport = page.getViewport(1.5);

		var canvasFactory = new NodeCanvasFactory();
		var canvasAndContext = canvasFactory.create(viewport.width, viewport.height);
		var renderContext = {
			canvasContext: canvasAndContext.context,
			viewport: viewport,
			canvasFactory: canvasFactory
		};

		var renderTask = page.render(renderContext);
		renderTask.promise.then(function () {
			// Convert the canvas to an image buffer.
			var image = canvasAndContext.canvas.toBuffer();
			fs.writeFile(`page${data.pageNum}.png`, image, function (error) {
				if (error) {
					console.error(`Error converting ${data.pageNum} page to a PNG image: ${error}`);
				} else {
					console.log(`Finished converting ${data.pageNum} page to a PNG image.`);
					myEE.emit('pdf-parsed', Object.assign(data, {canvasAndContext}));
				}
			});
		});
	});
});

myEE.on('pdf-parsed', data => {
	myEE.emit('divide-image-left', data);
});

myEE.on('divide-image-left', data => {
	
	var configLeft = {
		width: data.canvasAndContext.canvas.width / 2,
		height: data.canvasAndContext.canvas.height,
		top: 0,
		left: 0
	},
	imageLeft = (data.pageNum % 2 === 0 ? data.pageNum : ((data.numPages * 2) - (data.pageNum - 1)));

	PNGCrop.crop(`page${data.pageNum}.png`, `${imageLeft}.png`, configLeft, function (err) {
		if (err) {
			console.error(`Error while divide left image on the page${data.pageNum}.png`);
			throw err;
		}
		console.log(`Divide left image on the page${data.pageNum}.png done!`);
		myEE.emit('image-left-divided', data);
	});

});

myEE.on('image-left-divided', data => {
	myEE.emit('divide-image-right', data);
});

myEE.on('divide-image-right', data => {

	var configRight = {
		width: data.canvasAndContext.canvas.width / 2,
		height: data.canvasAndContext.canvas.height,
		top: 0,
		left: data.canvasAndContext.canvas.width / 2
	},
	imageRight = (data.pageNum % 2 === 0 ? ((data.numPages * 2) - (data.pageNum - 1)) : data.pageNum);
	
	PNGCrop.crop(`page${data.pageNum}.png`, `${imageRight}.png`, configRight, function (err) {
		if (err) {
			console.error(`Error while divide right image on the page${data.pageNum}.png`);
			throw err;
		}
		console.log(`Divide right image on the page${data.pageNum}.png done!`);
		myEE.emit('image-right-divided', data);
	});
});

myEE.on('image-right-divided', data => {

	fs.unlinkSync(`./page${data.pageNum}.png`);

	if (data.pageNum < data.numPages) {
		data.pageNum = data.pageNum + 1;
		myEE.emit('parse-page', data);
	} else {
		console.log('Document divided on images done!!!');
		myEE.emit('document-divided', data);
	}
});

myEE.on('document-divided', data => {

	console.log('Passing the images to PDF file.');

	const docName = `${dir}/${files[data.numDocument].split('.pdf')[0]}-processed.pdf`;

	const doc = new Pdfkit;

	doc.pipe(fs.createWriteStream(docName));

	for (var i = 1; i <= (data.numPages * 2); i++) {
		if (i > 1) {
			doc.addPage();
		}
		doc.image(`${i}.png`, 0, 0, {width: 600, height: 820, align: 'center', valign: 'center'});
		fs.unlinkSync(`./${i}.png`);
	}
	
	doc.end();

	console.log(`Document ${docName} generated!!!.`);

	myEE.emit('document-generated', data);
});

myEE.on('document-generated', data => {
	data.numDocument = data.numDocument + 1;
	if (files.length > data.numDocument) {
		myEE.emit('load-document', {numDocument: data.numDocument});
	} else {
		console.log(`Documents ${files} generated!!!.`);
	}
});


const dir = './documents';
let files = [];

if (fs.existsSync(dir)) {

	files = fs.readdirSync(dir);

	if (files.length > 0) {
		myEE.emit('load-document', {numDocument: 0});
	} else {
		console.log(`Files not found in folder "${dir}"`);
	}

} else {
	console.error('Folder "documents" not found, please create the folder and add the documents');
}