"use strict";

import * as THREE from '../modules/three.module.js';
import { GUI } from '../modules/dat.gui.module.js';
import Stats from '../modules/stats.module.js'
import { OrbitControls } from '../components/OrbitControls.js';
import { LineMaterial } from '../components/LineMaterial.js';
import { LineGeometry } from '../components/LineGeometry.js';
import { Line } from '../components/Line.js';

var stats;
var gui, globalOptions, baseSpaceOptions, appliedRotation;

var fiberResolution = 128;
var maxFiberResolution = 512;

var mainCamera, secondaryCamera, orbitControls, mainScene, secondaryScene, webGLRenderer;
var sphereGeometry, sphereMaterial, baseSpace;
var baseSpaceCircles = [];
var compressToBall = false;
var defaultRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1), Math.PI/2);

function HSVtoRGB(h, s, v) {
    var r, g, b, i, f, p, q, t;
    if (arguments.length === 1) {
        s = h.s, v = h.v, h = h.h;
    }
    i = Math.floor(h * 6);
    f = h * 6 - i;
    p = v * (1 - s);
    q = v * (1 - f * s);
    t = v * (1 - (1 - f) * s);
    switch (i % 6) {
        case 0: r = v, g = t, b = p; break;
        case 1: r = q, g = v, b = p; break;
        case 2: r = p, g = v, b = t; break;
        case 3: r = p, g = q, b = v; break;
        case 4: r = t, g = p, b = v; break;
        case 5: r = v, g = p, b = q; break;
    }
    return {
        r: Math.round(r * 255),
        g: Math.round(g * 255),
        b: Math.round(b * 255)
    };
}

function getRainbow(p, m) {
    var rgb = HSVtoRGB(p/m*0.85, 1.0, 1.0);
    return new THREE.Vector3(rgb.r,rgb.g,rgb.b);
}

function genHopfFiber(basePoint, resolution) {
    var r1 = new THREE.Quaternion(0, 1 + basePoint.x, basePoint.y, basePoint.z);
    r1.multiply(new THREE.Quaternion(1/Math.sqrt(2+2*basePoint.x),0,0,0));
    var fiber = [];
    for(var i = 0; i < resolution; i++) {
        var pt = new THREE.Quaternion;
        pt.multiplyQuaternions(r1, new THREE.Quaternion(Math.cos(2*Math.PI*i/resolution), Math.sin(2*Math.PI*i/resolution), 0, 0));
        fiber.push(pt);
    }
    return fiber;
}

function stereographicProjection(points) {
    var proj = [];
    for (var i = 0; i < points.length; i++) {
    var denominator = Math.max(1 - points[i].x, 0.001);
    var pt = new THREE.Vector3(points[i].y / denominator, points[i].z / denominator, points[i].w / denominator);
    proj[i] = pt;
    }
    if (!compressToBall)
        proj.push(proj[0]);
    return proj;
}

function compressR3ToBall(points) {
    for (var i = 0; i < points.length; i++) {
        var dist = points[i].distanceTo(new THREE.Vector3(0,0,0));
        var scaling = (dist/Math.sqrt((1+dist*dist)))/dist;
        points[i].x = points[i].x*scaling;
        points[i].y = points[i].y*scaling;
        points[i].z = points[i].z*scaling;
    }
    if (compressToBall)
        points.push(points[0]);
    return points;
}

class baseSpaceCircle {
    pointCoordinate(pointIndex) {
        return new THREE.Vector3(Math.cos(this.distanceToCenter_radians)*Math.sin(this.circumference * pointIndex / this.pointCount), 
                                 Math.sin(this.distanceToCenter_radians), 
                                 Math.cos(this.distanceToCenter_radians)*Math.cos(this.circumference * pointIndex / this.pointCount));
    }

    rotate() {
        if ((this.appliedRotation_axis.x > 0.001) || (this.appliedRotation_axis.y > 0.001) || (this.appliedRotation_axis.z > 0.001))
            for (var vertex in this.base_geometry.vertices)
                this.base_geometry.vertices[vertex].applyQuaternion(this.appliedRotation_quaternion);
        this.base_geometry.verticesNeedUpdate = true;
    }

    setAppliedRotation() {
        this.appliedRotation_quaternion = new THREE.Quaternion().setFromAxisAngle(this.appliedRotation_axis.normalize(), this.appliedRotation_angle);
    }

    updateFiberProjections() {
        var circleCount = this.projectedCircles_geometries.length;
        for (var index = 0; index < circleCount; index++)
        {
            this.projectedCircles_geometries[index].dispose();
            this.projectedCircles_materials[index].dispose();
            mainScene.remove(this.projectedCircles_objects[index]);
        }
        this.projectedCircles_objects = [];
        this.projectedCircles_geometries = [];
        this.projectedCircles_materials = [];

        for (var vertex in this.base_geometry.vertices) {
            var projectedCirclePts = stereographicProjection(genHopfFiber(this.base_geometry.vertices[vertex], fiberResolution));
            if (compressToBall)
                projectedCirclePts = compressR3ToBall(projectedCirclePts);
            var projectedCirclePts_ = [];
            for (var i = 0; i < fiberResolution+1; i++)
                projectedCirclePts_.push(projectedCirclePts[i].x, projectedCirclePts[i].y, projectedCirclePts[i].z);

            var colors = [];
            for (var i = 0; i < maxFiberResolution+1; i++)
                colors.push(this.base_geometry.colors[vertex].r, this.base_geometry.colors[vertex].g, this.base_geometry.colors[vertex].b);

            var geomLine = new LineGeometry();
            geomLine.setColors(colors);
            geomLine.setPositions(projectedCirclePts_);

            var matLine = new LineMaterial( {
                color: 0xffffff,
                linewidth: 0.003,
                vertexColors: true,
                dashed: false
            } );

            var line = new Line(geomLine, matLine);
            line.computeLineDistances();
            line.scale.set( 1, 1, 1 );

            this.projectedCircles_materials.push(matLine);
            this.projectedCircles_geometries.push(geomLine);
            this.projectedCircles_objects.push(line);

            mainScene.add(line);
        }
    }

    destroy() {
        this.base_geometry.dispose();
        this.base_material.dispose();
        secondaryScene.remove(this.base_object);
        for (var index in this.projectedCircles_objects) {
            this.projectedCircles_geometries[index].dispose();
            this.projectedCircles_materials[index].dispose();
            mainScene.remove(this.projectedCircles_objects[index]);
        }
            
    }

    constructor(distanceToCenter, circumference, pointCount, defaultRotation, appliedRotation_axis, appliedRotation_angle) {
        this.distanceToCenter;
        this.distanceToCenter_radians;
        this.circumference;
        this.pointCount;
        this.defaultRotation;
        this.appliedRotation_axis;
        this.appliedRotation_angle;
        this.appliedRotation_quaternion;
    
        this.base_geometry;
        this.base_material;
        this.base_object;
    
        this.projectedCircles_geometries = [];
        this.projectedCircles_materials = [];
        this.projectedCircles_objects = [];

        this.distanceToCenter = distanceToCenter;
        this.circumference = circumference;
        this.pointCount = pointCount;
        this.defaultRotation = defaultRotation;
        this.appliedRotation_axis = appliedRotation_axis;
        this.appliedRotation_angle = appliedRotation_angle;
        this.appliedRotation_quaternion = new THREE.Quaternion().setFromAxisAngle(appliedRotation_axis.normalize(), appliedRotation_angle);

        this.distanceToCenter_radians = distanceToCenter*Math.PI/2;
        this.base_geometry = new THREE.Geometry();
        for(var j = 0; j < pointCount; j++) {
            var pt = this.pointCoordinate(j);
            pt.applyQuaternion(defaultRotation);
            var color = getRainbow(j, pointCount);
            this.base_geometry.vertices.push(pt);
            this.base_geometry.colors.push(new THREE.Color(color.x/255,color.y/255,color.z/255));
        }

        this.base_material = new THREE.PointsMaterial( { size: 5, sizeAttenuation: false, vertexColors: THREE.VertexColors } );
        this.base_object = new THREE.Points(this.base_geometry, this.base_material);
        secondaryScene.add(this.base_object);

        this.updateFiberProjections();
        render();

    }
}

window.onload = function() {
    init();
    animate();
};


function initGui() {

    gui = new GUI();

    globalOptions = gui.addFolder('Global Controls');
    var param = {
        'Fiber resolution': 250,
        'Map R3 to B3': false,
        'Detach': function() {
            baseSpaceCircles.push(new baseSpaceCircle(0, Math.PI*2, 10, defaultRotation, new THREE.Vector3(0,0,0).normalize(), 0.0));
            baseSpaceOptions.__controllers.forEach(controller => controller.setValue(controller.initialValue));
            appliedRotation.__controllers.forEach(controller => controller.setValue(controller.initialValue));
          },
          'Clear all': function() {
            for (var index in baseSpaceCircles)
                baseSpaceCircles[index].destroy();
            baseSpaceCircles = [];
            baseSpaceCircles.push(new baseSpaceCircle(0, Math.PI*2, 10, defaultRotation, new THREE.Vector3(0,0,0).normalize(), 0.0));
            baseSpaceOptions.__controllers.forEach(controller => controller.setValue(controller.initialValue));
            appliedRotation.__controllers.forEach(controller => controller.setValue(controller.initialValue));
          }
    };
    globalOptions.add( param, 'Fiber resolution', 10,500,10 ).onChange( function ( val ) {
        fiberResolution = val;
        for (var index in baseSpaceCircles)
            baseSpaceCircles[index].updateFiberProjections();
        render();
    } );
    globalOptions.add( param, 'Map R3 to B3' ).onChange( function ( val ) {
        compressToBall = val;

        for (var i in baseSpaceCircles)
            baseSpaceCircles[i].updateFiberProjections();
        render();
    } );
    globalOptions.add(param, 'Detach');
    globalOptions.add(param, 'Clear all');

    baseSpaceOptions = gui.addFolder("Base Space Parametrization");
    var paramBaseSpace = {
        'Center offset': 0.3,
        'Circumference': 2*Math.PI,
        'Point count': 10,
        'X-component': 0.0,
        'Y-component': 0.0,
        'Z-component': 0.0,
        'Angle': 0.0,
    }
    baseSpaceOptions.add( paramBaseSpace, 'Center offset', -1, 0.999, 0.0001).onChange( function(val) {
        var index = baseSpaceCircles.length-1;
        var pointCount = baseSpaceCircles[index].pointCount;
        var defaultRotation = baseSpaceCircles[index].defaultRotation;
        var circumference = baseSpaceCircles[index].circumference;
        var appliedRotation_axis = baseSpaceCircles[index].appliedRotation_axis;
        var appliedRotation_angle = baseSpaceCircles[index].appliedRotation_angle;
        baseSpaceCircles.pop().destroy();
        baseSpaceCircles.push(new baseSpaceCircle(val, circumference, pointCount, defaultRotation, appliedRotation_axis.normalize(), appliedRotation_angle));
    });

    baseSpaceOptions.add( paramBaseSpace, 'Circumference', 0, 2*Math.PI, 0.01).onChange( function(val) {
        var index = baseSpaceCircles.length-1;
        var pointCount = baseSpaceCircles[index].pointCount;
        var defaultRotation = baseSpaceCircles[index].defaultRotation;
        var distanceToCenter = baseSpaceCircles[index].distanceToCenter;
        var appliedRotation_axis = baseSpaceCircles[index].appliedRotation_axis;
        var appliedRotation_angle = baseSpaceCircles[index].appliedRotation_angle;
        baseSpaceCircles.pop().destroy();
        baseSpaceCircles.push(new baseSpaceCircle(distanceToCenter, val, pointCount, defaultRotation, appliedRotation_axis.normalize(), appliedRotation_angle));
    });
    baseSpaceOptions.add( paramBaseSpace, 'Point count', 1, 250, 1).onChange( function(val) {
        var index = baseSpaceCircles.length-1;
        var circumference = baseSpaceCircles[index].circumference;
        var defaultRotation = baseSpaceCircles[index].defaultRotation;
        var distanceToCenter = baseSpaceCircles[index].distanceToCenter;
        var appliedRotation_axis = baseSpaceCircles[index].appliedRotation_axis;
        var appliedRotation_angle = baseSpaceCircles[index].appliedRotation_angle;
        baseSpaceCircles.pop().destroy();
        baseSpaceCircles.push(new baseSpaceCircle(distanceToCenter, circumference, val, defaultRotation, appliedRotation_axis.normalize(), appliedRotation_angle));
    });
    baseSpaceOptions.open();

    appliedRotation = baseSpaceOptions.addFolder('Applied Rotation Quaternion');
    appliedRotation.add( paramBaseSpace, 'X-component', 0.0, 1, 0.1).onChange( function(val) {
        baseSpaceCircles[baseSpaceCircles.length-1].appliedRotation_axis.x = val;
        baseSpaceCircles[baseSpaceCircles.length-1].setAppliedRotation();
        render();
    });
    appliedRotation.add( paramBaseSpace, 'Y-component', 0.0, 1, 0.1).onChange( function(val) {
        baseSpaceCircles[baseSpaceCircles.length-1].appliedRotation_axis.y = val;
        baseSpaceCircles[baseSpaceCircles.length-1].setAppliedRotation();
        render();
    });
    appliedRotation.add( paramBaseSpace, 'Z-component', 0.0, 1, 0.1).onChange( function(val) {
        baseSpaceCircles[baseSpaceCircles.length-1].appliedRotation_axis.z = val;
        baseSpaceCircles[baseSpaceCircles.length-1].setAppliedRotation();
        render();
    });
    appliedRotation.add( paramBaseSpace, 'Angle', 0.0, 0.1, 0.0001).onChange( function(val) {
        baseSpaceCircles[baseSpaceCircles.length-1].appliedRotation_angle = val;
        baseSpaceCircles[baseSpaceCircles.length-1].setAppliedRotation();
        render();
    });
}

function init() {
    mainCamera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.001, 1000);
    mainCamera.position.x = -3;
    mainCamera.position.y = 0;
    mainCamera.position.z = 2;
    mainCamera.lookAt(0,0,0);

    var aspect = window.innerWidth / window.innerHeight;
    var scale = 3;
    secondaryCamera = new THREE.OrthographicCamera(-aspect*scale, aspect*scale, 1*scale, -1*scale, 0.001, 1000);
    secondaryCamera.position.set(5,5,10);
    secondaryCamera.lookAt(0,0,0);

    mainScene = new THREE.Scene();

    secondaryScene = new THREE.Scene();

    sphereGeometry = new THREE.SphereGeometry(1,32,32);
    sphereMaterial = new THREE.MeshLambertMaterial({color: 0xffffff});
    sphereMaterial.transparent = true;
    sphereMaterial.opacity = 0.8;
    baseSpace = new THREE.Mesh(sphereGeometry,sphereMaterial);
    baseSpace.position.x = 4.5;
    baseSpace.position.y = -1;
    secondaryScene.add(baseSpace);
    var light = new THREE.PointLight( 0xffffff, 0.6, 0 );
    light.position.set( 10, 0, 0 );
    secondaryScene.add( light );
    var light2 = new THREE.AmbientLight( 0x404040 );;
    secondaryScene.add( light2 );

    webGLRenderer = new THREE.WebGLRenderer({antialias: true});
    webGLRenderer.setPixelRatio( window.devicePixelRatio );
    webGLRenderer.setSize( window.innerWidth , window.innerHeight );
    webGLRenderer.autoClear = false;

    orbitControls = new OrbitControls(mainCamera, webGLRenderer.domElement);

    window.addEventListener('resize', onWindowResize, false);
    document.body.appendChild(webGLRenderer.domElement);

    stats = new Stats();
    document.body.appendChild(stats.dom);

    initGui();

    baseSpaceCircles.push(new baseSpaceCircle(0, 2*Math.PI, 10, defaultRotation, new THREE.Vector3(0,0,0), 0.0));

    onWindowResize();
    render();
}

function onWindowResize(){
    mainCamera.aspect = window.innerWidth / window.innerHeight ;
    var aspect = window.innerWidth / window.innerHeight;
    var scale = 3;
    secondaryCamera.left = -aspect*scale;
    secondaryCamera.right = aspect*scale;
    secondaryCamera.top = 1*scale;
    secondaryCamera.bottom = -1*scale;
    baseSpace.position.x = 4.5 + 4*(window.innerWidth - 1920)/1920;
    secondaryCamera.updateProjectionMatrix();
    mainCamera.updateProjectionMatrix(); 
    webGLRenderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);
    orbitControls.update();

    stats.update();

    for (var index in baseSpaceCircles) {
        baseSpaceCircles[index].rotate();
        if (baseSpaceCircles[index].appliedRotation_angle > 0)
            baseSpaceCircles[index].updateFiberProjections();

        baseSpaceCircles[index].base_object.position.x = 4.5 + 4*(window.innerWidth - 1920)/1920;
        baseSpaceCircles[index].base_object.position.y = -1;
    }

    render();
}

function render() {
    webGLRenderer.clear();
    webGLRenderer.render(mainScene,mainCamera);
    webGLRenderer.clearDepth();
    webGLRenderer.render(secondaryScene, secondaryCamera);
}