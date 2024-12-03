
"use strict";

import { LineSegments } from "./LineSegments.js";
import { LineGeometry } from "./LineGeometry.js";
import { LineMaterial } from "./LineMaterial.js";

var Line = function ( geometry, material ) {

	LineSegments.call( this );

	this.type = 'Line';

	this.geometry = geometry !== undefined ? geometry : new LineGeometry();
	this.material = material !== undefined ? material : new LineMaterial( { color: Math.random() * 0xffffff } );

};

Line.prototype = Object.assign( Object.create( LineSegments.prototype ), {

	constructor: Line,

	isLine: true

} );

export { Line };
