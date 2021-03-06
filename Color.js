'use strict';

window.Color = (function () {

    var Color;

    function merge_objs () {
        var merged = {}, i, name, addon_obj;
        for (i = 0; i < arguments.length && arguments[i]; i++) {
            addon_obj = arguments[i];
            for (name in addon_obj) {
                if (addon_obj.hasOwnProperty(name)) {
                    merged[name] = addon_obj[name];
                }
            }
        }
        return merged;
    }
    
    function get_args (base_args, args, merge) {
        var arg,
            final_args = merge_objs({}, base_args);
        for (arg in args) {
            if (args.hasOwnProperty(arg) && args[arg] !== undefined) {
                if (arg in base_args || merge) {
                    final_args[arg] = args[arg];
                }
            }
        }
        return final_args;
    }

    function is_element (item) {
        return typeof(item) === 'object' && item.tagName !== undefined;
    }

    Color = {
        get: function (color, args) {
            var hue, result, i, rgb_clr, min, max, delta, tmp;
            args = get_args({
                format: 'hex', // e.g. hex, rgb, rgba, rgb_obj, hsv_obj
                surface: (is_element(color) ? 'color' : undefined)
            }, args);
            if (color === undefined) {
                throw new Error("Invalid color to get value of.");
            }
            if (args.surface) {
                color = window.getComputedStyle(color, null).style[args.surface];
            }
            if (typeof color === 'string') {
                if (color.match(/^#?[a-f0-9]{6}$/i)) {
                    // e.g. 0099FF, #996600
                    // add the # if it isn't there
                    if (color.substr(0, 1) !== '#') {
                        color = '#' + color;
                    }
                    // no conversion needed
                    if (args.format === 'hex') {
                        return color;
                    }
                } else if (color.substr(0, 3) === 'rgb') {
                    if (color.substr(0, 4) === 'rgba') {
                        // kill the alpha part if present
                        color = color.replace(/, \d+\)/, ')');
                    }
                    // e.g. rgb(255, 41, 6)
                    // no conversion needed
                    if (args.format === 'rgb') {
                        return color;
                    }
                    // get everything between "rgb(" and the ending ")"
                    color = color.substr(4, color.length - 5).split(',');
                    for (i = 0; i < color.length; i++) {
                        color[i] = parseInt(color[i]).toString(16);
                        if (color[i].length === 1) {
                            color[i] = '0' + color[i];
                        } else if (color[i].length > 2) {
                            throw new Error("Color component '" + color[i] + "' is out of bounds.");
                        }
                    }
                    color = '#' + color.join('');
                } else {
                    throw new Error("Invalid color string: '" + color + "'.");
                }
            } else if (typeof color === 'object') {
                result = '#';
                if (color.r !== undefined && color.g !== undefined && color.b !== undefined) {
                    // no conversion needed
                    if (args.format === 'rgb_obj') {
                        return color;
                    }
                    // make sure our colors are in order
                    color = {
                        r: color.r,
                        g: color.g,
                        b: color.b
                    };
                    for (hue in color) {
                        if (color.hasOwnProperty(hue)) {
                            color[hue] = color[hue].toString(16);
                            if (color[hue].length === 1) {
                                result += '0' + color[hue];
                            } else {
                                result += color[hue];
                            }
                        }
                    }
                } else if (color.h !== undefined && color.s !== undefined && color.v !== undefined) {
                    // no conversion needed
                    if (args.format === 'hsv_obj') {
                        return color;
                    }
                    if (color.s === 0) {
                        color = parseInt(color.v * 255).toString(16);
                        if (color.length === 1) {
                            color = '0' + color;
                        }
                        result = '#' + color + color + color;
                    } else {
                        color.h = (color.h % 360) / 60;
                        tmp = {
                            i: Math.floor(color.h)
                        };
                        tmp.f = color.h - tmp.i;
                        tmp.p = color.v * (1 - color.s);
                        tmp.q = color.v * (1 - color.s * tmp.f);
                        tmp.t = color.v * (1 - color.s * (1 - tmp.f));
                        if (tmp.i === 0) {
                            rgb_clr = {
                                r: color.v,
                                g: tmp.t,
                                b: tmp.p
                            };
                        } else if (tmp.i === 1) {
                            rgb_clr = {
                                r: tmp.q,
                                g: color.v,
                                b: tmp.p
                            };
                        } else if (tmp.i === 2) {
                            rgb_clr = {
                                r: tmp.p,
                                g: color.v,
                                b: tmp.t
                            };
                        } else if (tmp.i === 3) {
                            rgb_clr = {
                                r: tmp.p,
                                g: tmp.q,
                                b: color.v
                            };
                        } else if (tmp.i === 4) {
                            rgb_clr = {
                                r: tmp.t,
                                g: tmp.p,
                                b: color.v
                            };
                        } else if (tmp.i === 5) {
                            rgb_clr = {
                                r: color.v,
                                g: tmp.p,
                                b: tmp.q
                            };
                        } else {
                            throw new Error("Invalid color hue: '" + (color.h * 60) + "'.");
                        }
                        // now convert back to hex for further conversion
                        result = '#';
                        for (hue in rgb_clr) {
                            if (rgb_clr.hasOwnProperty(hue)) {
                                rgb_clr[hue] = parseInt(rgb_clr[hue] * 255, 10).toString(16);
                                if (rgb_clr[hue].length === 1) {
                                    result += '0' + rgb_clr[hue];
                                } else {
                                    result += rgb_clr[hue];
                                }
                            }
                        }
                    }
                } else {
                    throw new Error("Unrecognized color object.");
                }
                color = result;
            } else {
                throw new Error("Unrecognized color type: " + color + '.');
            }

            // and return as the requested format - we're in hex by default
                // still nothin' to do
            if (args.format === 'rgb') {
                color = 'rgb(' + parseInt(color.substr(1, 2), 16) + ', ' +
                    parseInt(color.substr(3, 2), 16) + ', ' +
                    parseInt(color.substr(5, 2), 16) + ')';
            } else if (args.format === 'hsv_obj') {
                // convert to RBG [0,1] first
                rgb_clr = {
                    'r': parseInt(color.substr(1, 2), 16) / 255,
                    'g': parseInt(color.substr(3, 2), 16) / 255,
                    'b': parseInt(color.substr(5, 2), 16) / 255
                };
                max = Math.max(rgb_clr.r, rgb_clr.g, rgb_clr.b);
                min = Math.min(rgb_clr.r, rgb_clr.g, rgb_clr.b);
                delta = max - min;
                color = {
                    h: 0,
                    s: 0,
                    v: max
                };
                if (max !== 0) {
                    color.s = delta / max;
                } else {
                    return {s: 0, h: 360, v: color.v};
                }
                if (rgb_clr.r === max) {
                    color.h = (rgb_clr.g - rgb_clr.b) / delta; // yellow/magenta range
                } else if (rgb_clr.g === max) {
                    color.h = 2 + (rgb_clr.b - rgb_clr.r) / delta; // cyan/yellow range
                } else {
                    color.h = 4 + (rgb_clr.r - rgb_clr.g) / delta; // yellow/magenta range
                }
                color.h *= 60;
                if (color.h < 0) {
                    color.h += 360;
                }
                color.h = parseInt(color.h, 10);
            } else if (args.format === 'rgb_obj') {
                color = {
                    'r': parseInt(color.substr(1, 2), 16),
                    'g': parseInt(color.substr(3, 2), 16),
                    'b': parseInt(color.substr(5, 2), 16)
                };
            } else if (args.format !== 'hex') {
                // we're in hex by default
                throw new Error("Invalid color format: '" + args.format + "'.");
            }
            return color;
        },

        blend: function (source, target, args) {
            var color, part;
            // if there are no steps or the offset is zero take the easy way out
            args = get_args({
                format: 'hex',
                ratio: 0.5,
                surface: undefined
            }, args);
            source = Color.get(source, {format: 'rgb_obj', surface: args.surface});
            target = Color.get(target, {format: 'rgb_obj', surface: args.surface});
            // easy cases
            if (args.ratio === 0) {
                color = source;
            } else if (args.ratio === 1) {
                color = target;
            } else {
                // and blend each part
                color = {
                    'r': parseInt((source.r * (1 - args.ratio)) + (target.r * args.ratio), 10),
                    'g': parseInt((source.g * (1 - args.ratio)) + (target.g * args.ratio), 10),
                    'b': parseInt((source.b * (1 - args.ratio)) + (target.b * args.ratio), 10)
                };
                // limit values to 0-255, in case the ratio is > 1 or < 0
                for (part in color) {
                    if (color.hasOwnProperty(part)) {
                        if (parseInt(color[part], 10) > 255) {
                            color[part] = 255;
                        } else if (parseInt(color[part], 10) < 0) {
                            color[part] = 0;
                        }
                    }
                }
            }
            return Color.get(color, {format: args.format});
        },
            
        mix: function (color, args) {
            /* arguments:
            args = {
                format: 'hex', // or any other format supported by "Color.get"
                hue: 0 - 360,
                hue_mult: 0.0 - 1.0,
                hue_shift: 0 - 360,
                saturation: 0.0 - 1.0,
                saturation_mult: 0.0 - 1.0,
                saturation_shift: 0 - 360,
                value: 0.0 - 1.0,
                value_mult: 0.0 - 1.0,
                value_shift: 0 - 360
            };
            */
            // can't use get_args as args effects are cumulative
            if (args === undefined) {
                args = {};
            }
            color = Color.get(color, {format: 'hsv_obj'});
            if (args.hue !== undefined) {
                color.h = args.hue;
            } 
            if (args.hue_mult !== undefined) {
                color.h *= args.hue_mult;
            }
            if (args.hue_shift !== undefined) {
                color.h += args.hue_shift;
            } 
            if (args.saturation !== undefined) {
                color.s = args.saturation;
            } 
            if (args.saturation_mult !== undefined) {
                color.s *= args.saturation_mult;
            }
            if (args.saturation_shift !== undefined) {
                color.s += args.saturation_shift;
            } 
            if (args.value !== undefined) {
                color.v = args.value;
            } 
            if (args.value_mult !== undefined) {
                color.v *= args.value_mult;
            }
            if (args.value_shift !== undefined) {
                color.v += args.value_shift;
            } 
            if (color.h < 0) {
                color.h = 360 + (color.h % 360);
            }
            if (color.h > 360) {
                color.h = color.h % 360;
            }
            if (color.s > 1) {
                color.s = 1;
            }
            if (color.s < 0) {
                color.s = 0;
            }
            if (color.v > 1) {
                color.v = 1;
            }
            if (color.v < 0) {
                color.v = 0;
            }
            return Color.get(color, args.format);
        },

        fade: function (colors, args) {
            var fade;
            args = get_args({
                steps: 1, // how many steps between colors
                allow_oob: true // whether or not to allow out-of-bounds colors
            }, args);
            // validate our colors object
            fade = {
                _args: args,
                colors: []
            };
            fade.set_steps = function (steps) {
                if (typeof(steps) === 'number' && steps >= 0) {
                    fade.steps = steps;
                    fade.size = ((fade.colors.length - 1) * fade.steps) + fade.colors.length;
                } else {
                    throw new Error("The number of steps must be 0 or greater.");
                }
            };
            fade.set_size = function (count) {
                // make sure this size can be used with this many colors
                if (count === fade.colors.length) {
                    fade.set_steps(0);
                } else {
                    // figure out how many steps we need to have the number of colors requested
                    fade.set_steps(
                        (count - fade.colors.length) / (fade.colors.length - 1)
                    );
                }
            };

            fade.get_colors = function (args) {
                var colors = [],
                    i;
                for (i = 0; i < fade.size; i += 1) {
                    colors.push(fade.get_color(i), args);
                }
                return colors;
            };

            fade.set_colors = function (colors, args) {
                var i;
                args = get_args({
                    surface: (is_element(colors) ? 'color' : undefined)
                }, args);
                if (typeof(colors) !== 'object' || colors.length === undefined) {
                    throw new Error("Invalid colors object; array of colors or elements expected.");
                }
                fade.colors = [];
                for (i = 0; i < colors.length; i += 1) {
                    fade.colors[i] = Color.get(colors[i], args);
                }
            };

            /* Get a color at the specified index. */
            fade.get_color = function (i, args) {
                var start_color_num, end_color_num, offset, blend_ratio,
                    depth = 0;
                args = get_args({
                    format: 'hex'
                }, args);
                if (i < 0 || i >= fade.size) {
                    if (! fade._args.allow_oob) {
                        throw new Error("Please enter a color number between 0 and " + fade.size - 1 + ".");
                    } else {
                        // otherwise, translate the step to exist in the range we've got
                        if (i < 0) {
                            i = i * -1;
                        }
                        if (i >= fade.size) {
                            depth = parseInt(i / fade.size, 10);
                            // if we're an odd number in depth then flip the fade around for smooth gradients (e.g. 0 1 2 3 2 1 0 1 2 ...)
                            if (depth % 2 === 1) {
                                i = fade.size - (i % fade.size) - 1;
                            } else {
                                i = i % fade.size;
                            }
                        }
                    }
                }
                // now get the color for the step we are on
                // figure out what color it is based on, what it is fading to, and which fade step it is on
                start_color_num = parseInt((i / fade.size), 10);
                end_color_num = start_color_num + 1;
                offset = i % (fade.steps + 2);
                blend_ratio = offset / (fade.steps + 2);
                return Color.blend(
                    fade.colors[start_color_num],
                    fade.colors[end_color_num],
                    {ratio: blend_ratio, format: args.format}
                );
            };
            fade.set_colors(colors);
            fade.set_steps(args.steps);
            return fade;
        }
    };

    return Color;
}());
