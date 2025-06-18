/*
 * L.Path.Transform an L.Path extension for dragging and rotating paths.
 *
 * @author w8r <info@w8r.name>
 * @license MIT
 */
(function (factory, window) {
  // define an AMD module that relies on 'leaflet'
  if (typeof define === 'function' && define.amd) {
    define(['leaflet'], factory);

  // define a Common JS module that relies on 'leaflet'
  } else if (typeof exports === 'object') {
    module.exports = factory(require('leaflet'));
  }

  // attach your plugin to the global 'L' variable
  if(typeof window !== 'undefined' && window.L){
    window.L.Path.Transform = factory(L);
  }
}(function (L) {
  'use strict';

  var Path = L.Path;
  var DomUtil = L.DomUtil;
  var Util = L.Util;
  var DomEvent = L.DomEvent;
  var Point = L.Point;

  var Transform = function(path, options) {
    this.path = path;
    this._matrix = null;
    this._project();
    this.setOptions(options);
  };

  Transform.prototype = {

    setOptions: function(options) {
      // @TODO: move to separate function
      this.options = this.options || {
        rotation: true,
        scaling:  true,
        uniformScaling: true,
        maxScale: 2,
        minScale: 0.25
      };
      Util.extend(this.options, options);
    },

    getMatrix: function() {
      return this._matrix;
    },

    getPoints: function() {
      return this._points;
    },

    // apply new matrix to path
    transform: function(matrix) {
      this.path.transform(matrix);
      this._matrix = matrix;
      return this;
    },

    // rescale path
    scale: function(scale, center) {
      center = center || this.path.getCenter();
      scale  = scale  || 1;

      var matrix = L.matrix(1, 0, 0, 1, center.x, center.y).
        scale(scale).
        translate(-center.x, -center.y);

      this.transform(matrix);
      return this;
    },

    // rotate path
    rotate: function(angle, center) {
      center = center || this.path.getCenter();
      angle  = angle  || 0;

      var matrix = L.matrix(1, 0, 0, 1, center.x, center.y).
        rotate(angle).
        translate(-center.x, -center.y);

      this.transform(matrix);
      return this;
    },

    // translates path
    translate: function(offset) {
      offset = offset || L.point(0, 0);

      var matrix = L.matrix(1, 0, 0, 1, offset.x, offset.y);
      this.transform(matrix);
      return this;
    },

    // destruct
    disable: function() {
      this.path.transform(null);
      this.path.off('drag', this._onDrag);
      this.dragging.disable();
    },

    // constructor
    enable: function(options) {
      this.dragging = new L.Draggable(this.path._renderer._container);
      this.setOptions(options);

      this.dragging.on('drag', this._onDrag, this);
      this.dragging.enable();
    },

    _onDrag: function(e) {
      var map = this.path._map;
      var pos = this.dragging._newPos.subtract(this.dragging._startPos);
      var M = this.getMatrix() || L.matrix(1, 0, 0, 1, 0, 0);
      var N = M.clone().translate(pos.x, pos.y);
      this.path.transform(N);
      this.path.fire('transform', {
        matrix: M,
        layer:  this.path
      });
    },

    _project: function() {
      // @TODO: respect path._parts object to handle holes
      this._points = this.path.getPoints();
    }
  };


  L.Path.prototype.getPoints = function() {
    if(!this._point) {
      return [];
    }
    return this._point;
  };


  L.Path.prototype.getCenter = function() {
    var pts = this.getPoints();
    return L.LineUtil.getCenter(pts, this._map);
  };


  L.Path.prototype.transform = function(matrix) {
    if(this._map) {
      if(matrix) {
        this._transform(matrix);
      } else if(this._matrix) {
        // reset transformation
        this._transform(this._matrix.inverse());
        this._matrix = null;
      }
    }
    return this;
  };


  L.Path.prototype._transform = function(matrix) {
    var map = this._map;
    this._matrix = this._matrix ? this._matrix.multiply(matrix) : matrix;

    this._points.forEach(function(point) {
      var p = matrix.transform(point);
      point.x = p.x;
      point.y = p.y;
    });
    this._project();
    this._update();
    this.fire('transformed');
  };

  L.Path.addInitHook(function() {
    this.on('add', function() {
      if(this.transform) {
        this.transform.enable(this.options.transform);
      }
    }, this);
  });

  return Transform;

}, window));
