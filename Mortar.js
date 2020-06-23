"use strict";

window.Mortar = (function () {
    var API, // API generator given a base URL to make get/post/etc easy
        Els, // jQuery-like helpers for (bulk) element manipulation
        Form, // Common form logic for validation, safe submission, field management, etc
        PromiseLite, // Lightweight promise for easily coordinating async operations
        Utils, // Misc JS helpers/shortcuts
        UI, // Easy UI/API management w/ node caching
        XHR; // Generic XHR request helper
    
    /*
    Misc helpers
    */
    Utils = {
        debug: function (msg, data) {
            if (console && console.log) {
                console.log(msg);
                if (data !== undefined) {
                    console.log(data);
                }
            }
        },

        $: function (query, el) {
            // poor man's caching
            if (typeof(query) !== 'string') {
                return query;
            }
            if (el === undefined) {
                el = document;
            }
            return el.querySelectorAll(query);
        },

        $1: function (query, el) {
            // poor man's caching
            if (typeof(query) !== 'string') {
                return query;
            }
            if (el === undefined) {
                el = document;
            }
            return el.querySelector(query);
        },

        epoch: function (inMs) {
            var epochMs = (new Date()).getTime();
            return inMs ? epochMs : parseInt(epochMs / 1000, 10);
        },

        // arbitrary precision rounding that JS so sorely lacks
        round: function (num, args) {
            var mod, intHalf, multiplier, i, toAdd;
            args = Utils.getArgs({
                interval: undefined, // round to nearest 4th (e.g 5.9 -> 4, 6.1 -> 8) (default: 1)
                decimal: undefined, // round to 10^n decimal (default: 0)
                minDecimal: undefined // pad the decimal with 0's to ensure min length, returns string
            }, args);
            if (args.interval !== undefined && args.decimal !== undefined) {
                throw new Error("Unable to use both the 'interval' and 'decimal' options.");
            }
            // do our rounding
            if (args.interval) {
                // round to the nearest interval
                mod = Math.abs(num) % args.interval;
                if (args.floor) {
                    if (num > 0) {
                        num -= mod;
                    } else {
                        num -= args.interval - mod;
                    }
                } else if (args.ceiling && mod !== 0) {
                    if (num > 0) {
                        num += args.interval - mod;
                    } else {
                        num += mod;
                    }
                } else {
                    intHalf = args.interval / 2;
                    if (mod >= intHalf) {
                        if (num > 0) {
                            num += args.interval - mod;
                        } else {
                            num -= args.interval - mod;
                        }
                    } else {
                        if (num > 0 || args.ceiling) {
                            num -= mod;
                        } else {
                            num += mod;
                        }
                    }
                }
            } else {
                // round, after adjusting to catch a decimal point
                multiplier = Math.pow(10, args.decimal ? args.decimal : 0);
                if (args.decimal) {
                    num *= multiplier;
                }
                if (args.ceiling && num % 1.0) {
                    // force it to round up
                    num += 0.5;
                } else if (args.floor && num % 1.0) {
                    // force it to round down
                    num -= 0.5;
                }
                num = Math.round(num);
                if (args.decimal) {
                    num /= multiplier;
                }
            }
            // ensure all zero values are positive signed to match common expectations
            if (num === -0) {
                num = 0;
            }
            if (args.minDecimal !== undefined) {
                num = String(num);
                toAdd = num.match(/\.(.*)$/);
                if (toAdd === null) {
                    // we're an integer, so add it all w/ a decimal point
                    toAdd = args.minDecimal;
                    num += '.';
                } else {
                    toAdd = args.minDecimal - toAdd[1].length;
                }
                for (i = 0; i < toAdd; i++) {
                    num += '0';
                }
            }
            return num;
        },

        escape: function (string) {
            var toEscape = {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#x27;',
                '`': '&#x60;'
            }, key;
            string = string === null ? '' : string + '';
            for (key in toEscape) {
                string = string.replace(key, toEscape[key]);
            }
            return string;
        },

        isEmpty: function (obj) {
            var key;
            if (obj === null) {
                return true;
            }
            if (type(obj) === 'string') {
                return obj === '';
            }
            if (obj.length !== undefined) {
                return obj.length === 0;
            }
            for (key in obj) {
                if (obj.hasOwnProperty(key)) {
                    return false;
                }
            }
            return true;
        },

        map: function (vals, func) {
            var result = [],
                index = 0,
                newVal,
                key;
            for (key in vals) {
                if (vals.hasOwnProperty(key)) {
                    newVal = Utils.get(func, vals[key], index, key);
                    result.push(newVal);
                    index += 1;
                }
            }
            return result;
        },

        every: function (vals, func, args) {
            var good, key, index;
            args = Utils.getArgs({
                abortEarly: true
            }, args);
            index = 0;
            good = true;
            for (key in vals) {
                if (vals.hasOwnProperty(key) && !Utils.get(func, vals[key], index, key)) {
                    good = false;
                    if (args.abortEarly) {
                        break;
                    }
                }
            }
            return good;
        },

        each: function (vals, func, args) {
            args = Utils.getArgs({
                abortEarly: false
            }, args);
            return Utils.every(vals, func, args);
        },

        has: function (obj, key) {
            return obj.hasOwnProperty(key);
        },

        // walk an object based on the path given, using dotted notation by default
        walkObj: function (obj, path, args) {
            var ptr = obj;
            args = Utils.getArgs({
                pathSeparator: '.'
            }, args);
            if (typeof(path) === 'string') {
                path = path.split(args.pathSeparator);
            }
            Utils.every(path, function (part) {
                var match, matched;
                // keys are either an object key or a 'query' where a JSON  object is passed to search for the first match (e.g. 'foo.{"bar":3}.name')
                if (part.substr(0, 1) === '{' && part.substr(part.length - 1) === '}') {
                    match = JSON.parse(part);
                    Utils.every(ptr, function (nextPtr) {
                        if (!matched && Utils.every(match, function (val, key) {
                            return val === nextPtr[key];
                        })) {
                            matched = nextPtr;
                            return;
                        }
                        return true;
                    });
                    if (matched) {
                        ptr = matched;
                        return true;
                    }
                    ptr = undefined;
                    return;
                } else if (!(part in ptr)) {
                    ptr = undefined;
                    return;
                } else {
                    ptr = ptr[part];
                    return true;
                }
            });
            return ptr;
        },

        // merge two (or more) objects together without modifying any parameters
        mergeObjs: function () {
            var merged = {}, i, name, addonObj;
            for (i = 0; i < arguments.length && arguments[i]; i++) {
                addonObj = arguments[i];
                for (name in addonObj) {
                    if (addonObj.hasOwnProperty(name)) {
                        merged[name] = addonObj[name];
                    }
                }
            }
            return merged;
        },

        // get arguments based on a set of defaults, optionally allowing extra args in
        getArgs: function (baseArgs, args, merge) {
            var arg,
                finalArgs = Utils.mergeObjs({}, baseArgs);
            for (arg in args) {
                if (args.hasOwnProperty(arg) && args[arg] !== undefined) {
                    if (arg in baseArgs || merge) {
                        finalArgs[arg] = args[arg];
                    }
                }
            }
            return finalArgs;
        },

        // return padded number; prepended with 0's by default
        padNum: function (num, chars, pad, append) {
            num = String(num);
            pad = pad || '0';
            while (num.length < chars) {
                if (append) {
                    num = String(num) + pad;
                } else {
                    num = pad + String(num);
                }
            }
            return num;
        },

        // date formatting
        date: function (date, args) {
            var now, diff, amt, dateParts,
                dateObj = typeof(date) !== 'object' ? new Date(date) : date,
                days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            args = Utils.getArgs({
                diff: undefined, // minutes, hours, days, auto
                short: false // e.g. 'Mon 12/31'
            }, args);
            if (args.diff && args.short) {
                throw new Error("Can't use date() args 'diff' and 'short' together.");
            }
            if (!dateObj.getTime()) {
                Utils.debug("Invalid date string: " + date);
                if (args.passed || args.until) {
                    return;
                }
                return date;
            }
            if (args.diff) {
                now = new Date();
                diff = Math.abs(
                    (dateObj.getTime() - now.getTime()) / 1000
                );
                if (args.diff === 'auto') {
                    dateParts = [];
                    amt = parseInt(diff / 86400);
                    if (amt >= 2) {
                        dateParts.push(amt + ' days');
                        diff -= amt * 86400;
                    }
                    amt = parseInt(diff / 3600);
                    if (amt >= 2) {
                        dateParts.push(amt + ' hrs');
                        diff -= amt * 3600;
                    }
                    amt = parseInt(diff / 60);
                    if (amt >= 1) {
                        dateParts.push(amt + ' mins');
                    } else if (dateParts.length === 0) {
                        // only bother with seconds if really recent
                        dateParts.push(amt + ' secs');
                    }
                } else if (args.diff === 'days') {
                    dateParts = [Utils.round(
                        diff / 86400, {decimal: 1}
                    ) + ' days'];
                } else if (args.diff === 'hours') {
                    dateParts = [Utils.round(
                        diff / 3600, {decimal: 1}
                    ) + ' hrs'];
                } else if (args.diff === 'minutes') {
                    dateParts = [Utils.round(
                        diff / 60, {decimal: 1}
                    ) + ' mins'];
                } else {
                    throw new Error("Unknown 'args.diff' value: " + args.diff);
                }
                return dateParts.join(', ');
            }
            if (args.short) {
                // e.g. 'Mon 6/5'
                return days[dateObj.getDay()] + ' ' + dateObj.getMonth() + '/' + dateObj.getDate();
            }
            // e.g. 'Mon 6/5/2017, 2:15:31 PM'
            return days[dateObj.getDay()] + ' ' + dateObj.toLocaleString();
        },

        // calls each argument if it is a function, passing the remaining
        // arguments as parameters; stops once a non-function value is reached
        // and returns the result
        get: function (obj, obj1) {
            var type, params, i, objs;
            // call function if given, and use supplied args.
            // if args are a function, call them for the args.
            // passes 'obj' to functions
            type = typeof(obj);
            objs = [];
            if (type === 'function') {
                // if we have extra arguments to the right pass 'em as params
                if (arguments.length > 2) {
                    for (i = 2; i < arguments.length; i++) {
                        objs.push(arguments[i]);
                    }
                } else {
                    objs = [];
                }
                // if our next argument is also a function then call it too
                if (typeof(obj1) === 'function') {
                    params = [obj1.apply(this, objs)];
                } else {
                    params = [obj1];
                }
                for (i = 0; i < objs.length; i++) {
                    params.push(objs[i]);
                }
                return obj.apply(this, params);
            } else {
                return obj;
            }
        },

        // generate a custom event, IE9+ friendly
        customEvent: function (el, name, data, args) {
            var ev;
            args = Utils.getArgs({
                bubbles: undefined,
                cancellable: undefined
            }, args);
            if (window.CustomEvent) {
                try {
                    // IE11 sucks... hard... this still doesn't work
                    ev = new CustomEvent(name, {
                        detail: data,
                        cancelable: args.cancellable,
                        bubbles: args.bubbles
                    });
                } catch (ex) {
                    Utils.debug(ex);
                }
            }
            if (!ev) {
                ev = document.createEvent('CustomEvent');
                ev.initCustomEvent(name, args.bubbles, args.cancellable, data);
            }
            el.dispatchEvent(ev);
        },

        // generate an HTML event, IE9+
        htmlEvent: function (el, name) {
            var ev = document.createEvent('HTMLEvents');
            ev.initEvent(name, true, false);
            el.dispatchEvent(ev);
            return ev;
        },

        // cause DOM events on one element to happen on another (e.g. labels to cause radio buttons to be clicked)
        reflect: function (events, srcEl, tgtEl, custom) {
            if (typeof(events) === 'string') {
                events = events.split(' ');
            }
            events.forEach(function (evName) {
                evName = evName.trim();
                srcEl.addEventListener(evName, function (ev) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    if (custom) {
                        Utils.customEvent(tgtEl, evName, {
                            srcEvent: ev,
                            srcEl: srcEl
                        });
                    } else {
                        Utils.htmlEvent(tgtEl, evName);
                    }
                });
            });
        },

        // cause an element to be shown below another element, positioning to the left but still within the viewport
        positionAt: function (el, tgtEl, args) {
            var elStyle, elWidth,
                sbWidth = 20, // scroll bar width... estimated
                $el = Els(el),
                parentRect = tgtEl.offsetParent.getBoundingClientRect(),
                tgtElRect = tgtEl.getBoundingClientRect(),
                docRect = document.body.getBoundingClientRect(),
                left = tgtElRect.left + parentRect.left;
            args = Utils.getArgs({
                resize: true // resize the width if we can't fit
            }, args);
            if (args.resize) {
                // start with a normal size width
                el.style.width = '';
                elStyle = window.getComputedStyle(el, null);
                // assume we have a scrollbar to account for
                elWidth = parseInt(elStyle.width, 10) + parseInt(elStyle.marginRight, 10);
                if (elStyle.boxSizing !== 'border-box') {
                    elWidth += parseInt(elStyle.paddingLeft, 10) + parseInt(elStyle.paddingLeft, 10);
                }
                if (elWidth > docRect.width - sbWidth) {
                    el.style.width = (docRect.width - sbWidth - parseInt(elStyle.marginRight, 10)) + 'px';
                }
            }
            elStyle = window.getComputedStyle(el, null);
            $el.style({
                top: (
                    tgtEl.offsetParent.scrollTop +
                    (tgtElRect.bottom - parentRect.top) +
                    8
                ) + 'px',
                // make sure we're not offscreen to the right
                left: (
                    left + Math.min(0, docRect.width - (
                        left +
                        parseInt(elStyle.width, 10) +
                        parseInt(elStyle.paddingLeft, 10) +
                        parseInt(elStyle.paddingRight, 10) +
                        parseInt(elStyle.marginRight, 10) +
                        sbWidth
                    ))
                ) + 'px'
            });
            return el;
        }
    };

    /*
    DOM element wrapper to provide simple jQuery-like functionality (e.g. traversal)
    */
    Els = function () {
        var els = [];

        // condense all args into a single array of elements
        Array.prototype.slice.call(arguments).forEach(function (arg) {
            var i = -1, key;
            // nodelist or element/array of elements?
            if (arg.length !== undefined && arg.tagName === undefined && typeof(arg) !== 'string') {
                while (arg[++i]) {
                    els = els.concat(arg[i]);
                }
            } else if (typeof(arg) === 'object') {
                if (arg.tagName === undefined) {
                    // it is an object containing elements as values?
                    for (key in arg) {
                        if (arg.hasOwnProperty(key) && arg[key].tagName !== undefined) {
                            els.push(arg[key]);
                        }
                    }
                } else {
                    // or perhaps just a single element?
                    els = els.concat(arg);
                }
            } else {
                throw new Error("Unrecognized argument to Utils.Els: " + arg);
            }
        });

        // returns whether the element matches the selector/selectors (or just some)
        els.is = function (sels, any, args) {
            var func = any ? 'some' : 'every',
                selFunc ;
            args = Utils.getArgs({
                or: false
            }, args);
            selFunc = args.or ? 'some' : 'every';
            if (typeof(sels) !== 'object') {
                sels = [sels];
            }
            return els[func](function (el) {
                return sels[selFunc](function (sel) {
                    return (
                        el.matches ||
                        el.matchesSelector ||
                        el.msMatchesSelector ||
                        el.mozMatchesSelector ||
                        el.webkitMatchesSelector ||
                        el.oMatchesSelector
                    ).call(el, sel);
                });
            });
        };

        // generic callback method for chaining, as forEach/filter/etc are terminal
        els.each = function (func) {
            if (typeof(func) === 'function') {
                els.forEach(func);
            }
            return els;
        };

        // generic callback method for chaining, but invoked onced for the entire set of elements
        els.all = function (func) {
            if (typeof(func) === 'function') {
                func(els);
            }
            return els;
        };

        els.on = function (eventNames, func, args) {
            return els.toggleEvent(eventNames, func, args);
        };

        els.off = function (eventNames, func, args) {
            return els.toggleEvent(eventNames, func, args, true);
        };

        els.toggleEvent = function (eventNames, func, args, remove) {
            eventNames.split(' ').forEach(function (eventName) {
                els.forEach(function (el) {
                    if (remove) {
                        el.removeEventListener(eventName, func, args);
                    } else {
                        el.addEventListener(eventName, func, args);
                    }
                });
            });
        };

        // generic addEventListener wrapper
        els.bind = function (events, args) {
            // at some point we may want more detailed args, but until then...
            if (typeof(args) === 'function') {
                args = {onTrigger: args};
            }
            args = Utils.getArgs({
                onTrigger: function () {}
            }, args);
            if (typeof(events) === 'string') {
                events = events.trim().split(' ');
            }
            els.forEach(function (el) {
                events.forEach(function (evName) {
                    el.addEventListener(evName.trim(), args.onTrigger);
                });
            });
            return els;
        };

        els.trigger = function (events, args) {
            args = Utils.getArgs({
                custom: false,
                data: undefined
            }, args);
            if (args.data !== undefined && !args.custom) {
                throw new Error("Can't supply event data on non-custom events.");
            }
            if (typeof(events) === 'string') {
                events = events.trim().split(' ');
            }
            els.forEach(function (el) {
                events.forEach(function (evName) {
                    if (args.custom) {
                        Utils.htmlEvent(el, evName);
                    } else {
                        Utils.customEvent(el, evName, args.data);
                    }
                });
            });
            return els;
        };

        // check whether all (or just some) elements and/or their parents are displayed (e.g. for event delivery)
        els.isDisplayed = function (args) {
            var func;
            args = Utils.getArgs({
                ignoreSelf: undefined,
                any: undefined
            }, args);
            func = args.any ? 'some' : 'every';
            return els.length && els[func](function (el) {
                var ptr, style;
                if (!el.parentElement && !args.ignoreSelf) {
                    return false;
                }
                ptr = el;
                while (ptr) {
                    style = window.getComputedStyle(ptr, null);
                    if (ptr.tagName === 'BODY') {
                        return true;
                    } else if (style.display === 'none') {
                        return false;
                    }
                    ptr = ptr.parentElement;
                }
                return false;
            });
        };

        // returns whether all (or just some) elements are nested within another element
        els.isWithin = function (args) {
            var func;
            args = Utils.getArgs({
                parentEl: undefined,
                any: undefined
            }, args);
            func = args.any ? 'some' : 'every';
            return els.length && els[func](function (el) {
                var ptr, result = false;
                ptr = el;
                while (ptr.parentElement) {
                    result = (ptr.parentElement === args.parentEl);
                    if (ptr.parentElement.tagName === 'BODY' || result) {
                        break;
                    }
                    ptr = ptr.parentElement;
                }
                return result;
            });
        };

        // bulk style modification
        els.style = function (styles) {
            if (styles === undefined) {
                return;
            }
            els.forEach(function (el) {
                var style;
                for (style in styles) {
                    if (styles.hasOwnProperty) {
                        el.style[style] = styles[style];
                    }
                }
            });
            return els;
        };

        // bulk property modification
        els.props = function (props) {
            if (props === undefined) {
                return;
            }
            els.forEach(function (el) {
                var prop;
                for (prop in props) {
                    if (props.hasOwnProperty) {
                        el[prop] = props[prop];
                    }
                }
            });
            return els;
        };

        // ensure a class is added or removed; if add=undefined it'll be toggled dynamically
        els.toggleClass = function (cls, add) {
            els.forEach(function (el) {
                var list = el.className.split(' '),
                    clsIndex = list.indexOf(cls),
                    hasCls = clsIndex >= 0;
                if (add === undefined) {
                    add = !hasCls;
                }
                if (add && !hasCls) {
                    list.push(cls);
                } else if (!add && hasCls) {
                    list.splice(clsIndex, 1);
                }
                el.className = list.join(' ');
            });
            return els;
        };

        // return all parent elements based on selector
        // depth = # of ancestors behond the parent to search (e.g. 0 = no grandparents; undefined = no limit)
        els.parents = function (selector, args) {
            var all = [];
            args = Utils.getArgs({
                count: undefined,
                depth: undefined
            }, args);
            els.forEach(function (el) {
                var ptr = el,
                    curDepth = -1; // we look at the first parent no matter what
                while (ptr.parentElement &&
                    (!args.count || all.length < args.count) &&
                    (args.depth === undefined || curDepth < args.depth)
                    ) {
                    if (all.indexOf(ptr.parentElement) === -1 && (
                            !selector || Els(ptr.parentElement).is(selector)
                        )) {
                        all.push(ptr.parentElement);
                    }
                    curDepth += 1;
                    ptr = ptr.parentElement;
                }
            });
            return Els(all);
        };

        // return the siblings, optionally based on selector
        els.siblings = function (selector) {
            var all = [];
            els.forEach(function (el) {
                all = all.concat(
                    Array.prototype.filter.call(el.parentNode.children, function (sibling) {
                        return sibling !== el && 
                            (!selector || Els(sibling).is(selector)) &&
                            all.indexOf(sibling) === -1;
                    })
                );
            });
            return Els(all);
        };

        /*
        return all the children, optionally limited to a selector or limited count/depth 
        - depth = "true" for unlimited
         -- 1 = immediate children (effectively same as false/undefined/0)
         -- 2, 3, etc. = number of levels to decend; 
         -- -1 = unlimited
        */
        els.children = function (selector, args) {
            var all = [];
            args = Utils.getArgs({
                count: undefined,
                depth: 0
            }, args);
            if (!els.length) {
                return;
            }
            els.forEach(function (el) {
                // abort early if we already found all our matches
                if (args.count && all.length >= args.count) { return; }
                // add any unique matchs from our immediate children
                all = all.concat(Array.prototype.filter.call(el.children, function (child) {
                    return child && 
                        (!selector || Els(child).is(selector)) &&
                        all.indexOf(child) === -1 &&
                        (!args.count || all.length < args.count);
                }));
                // don't continue if we have what we need
                if (args.count && all.length >= args.count) { return; }
                // otherwise keep scanning deeper if we have a positive (or unlimited) depth
                if (args.depth === -1 || (args.depth && el.children.length)) {
                    all = all.concat(Els(el.children).children(selector, {
                        count: args.count ? args.count - all.length : args.count,
                        depth: args.depth !== true ? args.depth - 1 : args.depth
                    }));
                    if (args.count && all.length >= args.count) { return; }
                }
            });
            // got too many after last batch? trim back
            if (args.count && all.length >= args.count) {
                all = all.slice(0, args.count);
            }
            return Els(all);
        };

        /*
        find the nearest element(s) (default: 1 per source el) matching the selector given by scanning each parent's children
        - count = number of nearest elments to find for each source el
        - upDepth = how far up to scan; terminates at document.body otherwise
        - downDepth = how far down to scan after each traversal upwards; default=unlimited
        - stopAt = when traversing up don't go beyond the selector given
        */
        els.nearest = function (selector, args) {
            var all = [];
            args = Utils.getArgs({
                count: 1,
                upDepth: undefined,
                downDepth: -1,
                stopAt: undefined
            }, args);
            els.forEach(function (el) {
                var matches = [],
                    curDepth = -1, // always look at the first parent's children
                    ptrEl = el,
                    lastEl = ptrEl,
                    count = args.count;  // we need a localized count for each src el
                while (ptrEl !== document.body &&
                    (!count || matches.length < count) &&
                    (args.upDepth === undefined || curDepth < args.depth)
                    ) {
                    // see if we have any matches at this level
                    matches = matches.concat(Els(ptrEl).children(selector, {
                        except: [lastEl],
                        depth: args.downDepth,
                        count: count ? count - matches.length : count
                    }));
                    lastEl = ptrEl;
                    ptrEl = ptrEl.parentElement;
                    // check our parent element before iterating upwards or all src els will match the same 'first-child' element
                    if (!count || matches.length < count) {
                        if (Els(ptrEl).is(selector)) {
                            matches.push(ptrEl);
                        }
                    }
                    curDepth += 1;
                    if (count && matches.length >= count) { break; }
                    if (args.stopAt && Els(lastEl).is(args.stopAt)) { break; }
                }
                // add in any unique matches, as each src el may match the same parent
                matches.forEach(function (match) {
                    if (all.indexOf(match) === -1) {
                        all.push(match);
                    }
                });
            });
            return Els(all);
        };

        /* cause elements to appear near another element */
        els.positionAt = function (tgtEl, args) {
            els.forEach(function (el) {
                Utils.positionAt(el, tgtEl, args);
            });
            return els;
        };

        /* set HTML for elements */
        els.html = function (html, args) {
            args = Utils.getArgs({
                prepend: false,
                append: false
            }, args);
            if (args.prepend && args.append) {
                throw new Error("Prepending and appending HTML at the same time is not supported.");
            }
            els.forEach(function (el) {
                if (args.prepend) {
                    el.innerHTML = html + el.innerHTML;
                } else if (args.append) {
                    el.innerHTML = el.innerHTML + html;
                } else {
                    el.innerHTML = html;
                }
            });
            return els;
        };

        /* remove elements from the DOM */
        els.remove = function () {
            els.forEach(function (el) {
                el.parentElement.removeChild(el);
            });
        };

        /*
        read an attribute from the current node or one of its parents
        may optionally also (or instead) look downwards for the attribute (-1 = unlimited, otherwise # of levels)
        */
        els.readAttribute = function (attr, args) {
            var match;
            args = Utils.getArgs({
                upDepth: undefined,
                downDepth: undefined
            }, args);
            els.some(function (el) {
                if (el.hasAttribute(attr)) {
                    match = el;
                    return true;
                }
            });
            // always look up by default
            if (!match && args.upDepth !== 0) {
                match = els.parents('[' + attr + ']', 1, args.upDepth)[0];
            }
            // but down only upon request
            if (!match && args.downDepth !== undefined) {
                match = els.children('[' + attr + ']', {count: 1, depth: args.downDepth})[0];
            }
            if (match) {
                return match.getAttribute(attr);
            }
        };

        /* scroll to make the first element visible */
        els.scrollVisible = function (args) {
            var first, rect, target;
            args = Utils.getArgs({
                margin: 0,
                scrollOn: document.body
            }, args);
            if (!els.length) {
                return;
            }
            first = els[0];
            rect = first.getBoundingClientRect();
            target = parseInt(rect.top - args.margin, 10);
            // scrolled too far down to see the top?
            if (target < 0) {
                args.scrollOn.scrollTop = parseInt(args.scrollOn.scrollTop + target, 10);
            } else if (target > window.innerHeight) {
                // not scrolled down far enough?
                args.scrollOn.scrollTop = parseInt(args.scrollOn.scrollTop + target - window.innerHeight, 10);
            }
        };

        /* scroll to make the first element shown at the top of the viewport */
        els.scrollToTop = function (args) {
            var first, rect, target, ptr;
            args = Utils.getArgs({
                margin: 0,
                scrollOn: undefined
            }, args);
            if (!els.length) {
                return;
            }
            first = els[0];
            // look to see who in our chain of parents is scrolled by default
            if (!args.scrollOn) {
                ptr = first;
                while (!ptr.scrollTop && ptr !== document.body) {
                    ptr = ptr.parentElement;
                }
                args.scrollOn = ptr;
            }
            rect = first.getBoundingClientRect();
            target = parseInt(args.scrollOn.scrollTop +
                rect.top -
                args.margin -
                parseInt(window.getComputedStyle(first).marginTop, 10) -
                ptr.getBoundingClientRect().top, 10);
            args.scrollOn.scrollTop = target;
        };

        return els;
    };

    /*
    Generic XHR wrapper
    */
    XHR = (function () {
        function toQueryString(obj) {
            var name, pairs = [];
            for (name in obj) {
                if (obj.hasOwnProperty(name)) {
                    pairs.push(encodeURIComponent(name) + '=' + encodeURIComponent(obj[name]));
                }
            }
            return pairs.join('&');
        }

        function xhr (type, url, data, args) {
            var request = new XMLHttpRequest(),
                promise = PromiseLite({this: this, task: request});

            args = Utils.getArgs({
                'timeout': 30,
                'async': true
            }, args);
            if (data) {
                if (type.toUpperCase() === 'GET') {
                    if (typeof(data) === 'object') {
                        data = toQueryString(data);
                    }
                    if (url.indexOf('?') !== -1) {
                        url = url + '&' + data;
                    } else {
                        url = url + '?' + data;
                    }
                } else {
                    data = JSON.stringify(data);
                }
            }
            request.open(type, url, true);
            request.timeout = args.timeout;
            request.setRequestHeader('Content-type', xhr.contentType);
            request.onreadystatechange = function () {
                var response, contentType;
                if (request.readyState === 4) {
                    // if the XHR request didn't timeout, parse the response
                    if (request.status) {
                        contentType = request.getResponseHeader('Content-Type');
                        if (contentType && contentType.indexOf('application/json') === 0) {
                            response = JSON.parse(request.responseText);
                        } else {
                            response = request.responseText;
                        }
                    } else {
                        // match the JSON formatting that real API errors use
                        response = {
                            message: 'Request timed out after ' + request.timeout + 'ms'
                        };
                    }
                    promise.complete(
                        request.status >= 200 && request.status < 300,
                        [response, request]
                    );
                }
            };
            request.send(data);
            return promise;
        }

        xhr.contentType = 'application/json';

        xhr.get = function (url, data, args) {
            return xhr('GET', url, data, args);
        };
        xhr.post = function (url, data, args) {
            return xhr('POST', url, data, args);
        };
        xhr.put = function (url, data, args) {
            return xhr('PUT', url, data, args);
        };
        xhr['delete'] = function (url, data, args) {
            return xhr('DELETE', url, data, args);
        };
        xhr.batch = function (batch) {
            /* e.g.
            API.batch([
                {
                    method: 'get',
                    apiArgs: [url, data, ...],
                    then: function () {}, // see args below
                    error: function () {},
                    always: function () {}
                },
                {...}
            ]).then|always|error(...);

            Arguments passed to callbacks:
                (response, request, index, results)
            */
            var promise, results = [];
            promise = PromiseLite({this: this, count: batch.length});
            promise.then(batch.then);
            promise.error(batch.error);
            promise.always(batch.always);
            batch.map(function (api, index) {
                results.push({
                    response: undefined,
                    request: undefined,
                    then: undefined,
                    api: api,
                    index: index,
                    results: results,
                    batch: batch
                });
                xhr[api.method].apply(this, api.apiArgs)
                    .then(function (response, request) {
                        results[index].response = response;
                        results[index].request = request;
                        results[index].success = true;
                        if (typeof(api.then) === 'function') {
                            api.then.call(promise.args.this, response, request, api, index, results);
                        }
                        promise.complete(true, [results[index]]);
                    })
                    .error(function (response, request) {
                        results[index].response = response;
                        results[index].request = request;
                        results[index].success = false;
                        if (typeof(api.error) === 'function') {
                            api.error.call(promise.args.this, response, request, api, index, results);
                        }
                        promise.complete(false, [results[index]]);
                    })
                    .always(function (response, request) {
                        if (typeof(api.always) === 'function') {
                            api.always.call(promise.args.this, response, request, api, index, results);
                        }
                    });
            });
            return promise;
        };

        return xhr;
    })();

    /*
    API wrapper
    */
    API = function (apiUrl) {
        if (apiUrl.substr(-1) !== '/') {
            apiUrl = apiUrl + '/';
        }
        return {
            request: function (method, url, data, args) {
                return XHR.bind(this)(
                    method.toUpperCase(),
                    apiUrl + url,
                    data,
                    args
                );
            },
            get: function (url, data, args) {
                return XHR.bind(this)(
                    'GET',
                    apiUrl + url,
                    data,
                    args
                );
            },
            post: function (url, data, args) {
                return XHR.bind(this)(
                    'POST',
                    apiUrl + url,
                    data,
                    args
                );
            },
            put: function (url, data, args) {
                return XHR.bind(this)(
                    'PUT',
                    apiUrl + url,
                    data,
                    args
                );
            },
           'delete': function (url, data, args) {
                return XHR.bind(this)(
                    'DELETE',
                    apiUrl + url,
                    data,
                    args
                );
            },
            batch: function (batch) {
                // inject the API URL for each item in the batch
                batch.map(function (item) {
                    if (!item.apiArgs.length) {
                        throw new Error("Missing API arguments for batch API call");
                    }
                    item.apiArgs[0] = apiUrl + item.apiArgs[0];
                });
                return XHR.batch.bind(this)(batch);
            }
        };
    };

    /*
    Lightweight Promise
    - multiple then/error/always callbacks; all callbacks run in the order they are attached
    - "this" proxying for easy binding
    - callbacks return values override the result values
    - wrap/chain for synchronizing promises
    - "batch" oriented promises to track multiple tasks via a single promise
    - rewindable to allow promises to be re-completed (e.g. more new tasks to track, don't want to loose/repeat history)
    */
    PromiseLite = function (args) {
        var promise = {
            args: Utils.getArgs({
                this: this,
                task: undefined, // for the caller's reference only
                count: 1 // number of tasks to complete
            }, args),
            finished: false, // has the task been completed?
            task: undefined, // set by args.task below
            tasksLeft: undefined, // set by args.count
            tasksFailed: 0,
            tasksResults: [], // each item should be an array
            retval: undefined, // succeeded? true/false
            resultVals: undefined, // final callback results based on promise.tasksResults
            callbacks: [], // each entry is the callback type (e.g. 'then', 'error', 'always) and then the function; e.g.: [["then", function () {}], ["always", function () {}]]
            _doCallback: function (callback) {
                var result;
                if (typeof(callback) === 'function') {
                    result = callback.apply(
                        promise.args.this,
                        promise.resultVals
                    );
                    if (result !== undefined) {
                        // if only a single response is returned, only modify the first param (e.g. usually the XHR response object)
                        if (typeof(result) !== 'object' || !result.length) {
                            throw new Error("PromiseLite callback should always return an array of result values.");
                        }
                        promise.resultVals = result;
                    }
                }
            },
            _queueCallback: function (queue, callback) {
                // invoke (if appropriate) if we're already done; else queue away
                if (promise.finished) {
                    if (queue === 'then') {
                        if (promise.retval) {
                            promise._doCallback(callback);
                        }
                    } else if (queue === 'error') {
                        if (!promise.retval) {
                            promise._doCallback(callback);
                        }
                    } else { // always
                        promise._doCallback(callback);
                    }
                } else {
                    promise.callbacks.push([queue, callback]);
                }
            },
            // allow user to attach multiple callback handlers
            then: function (callback) {
                promise._queueCallback('then', callback);
                return promise;
            },
            error: function (callback) {
                promise._queueCallback('error', callback);
                return promise;
            },
            always: function (callback) {
                promise._queueCallback('always', callback);
                return promise;
            },
            // call another function to returns promise that sets the return value of this promise
            chain: function (chainFunc) {
                var chainedPromise;
                if (typeof(chainFunc) !== 'function') {
                    throw new Error("Invalid argument to promise.wrap(); function returning a promise expected.");
                }
                chainedPromise = PromiseLite({this: promise.args.this});
                promise.then(function () {
                    chainFunc.apply(promise.args.this, arguments)
                        .then(function () {
                            chainedPromise.complete(true, arguments);
                        })
                        .error(function () {
                            chainedPromise.complete(false, arguments);
                        });
                });
                return chainedPromise;
            },
            // complete a related promise once this one is completed
            wrap: function (otherPromise) {
                return promise.then(function () {
                    otherPromise.complete(true, arguments);
                }).error(function () {
                    otherPromise.complete(false, arguments);
                });
            },
            // to be called when the task finishes; assume true by default
            complete: function (success, resultVals) {
                if (promise.finished) {
                    throw new Error("PromiseLite attempted to be completed a second time.");
                }
                if (success === undefined) {
                    success = true;
                }
                promise.tasksFailed = success ? 0 : 1;
                promise.tasksResults.push(resultVals);
                promise.tasksLeft -= 1;
                if (!promise.tasksLeft) {
                    promise.finished = true;
                    promise.retval = promise.tasksFailed ? false : true;
                    // only send first result for single task, otherwise send the lot
                    promise.resultVals = promise.tasksResults.length === 1 ?
                        promise.tasksResults[0] :
                        promise.tasksResults;
                    // its easiest to run the callbacks in order defined so 'then' and 'always' can be in mixed order
                    promise.callbacks.forEach(function (item) {
                        var queue = item[0],
                            callback = item[1];
                        if (queue === 'then' && promise.retval) {
                            promise._doCallback(callback);
                        } else if (queue === 'error' && !promise.retval) {
                            promise._doCallback(callback);
                        } else if (queue === 'always') {
                            promise._doCallback(callback);
                        }
                    });
                    // clear the callback queues -- if we uncomplete the promise, as its possible existing callbacks might try to complete wrapped/chained promises that are already finished; it also probably isn't worth keeping them in memory
                    promise.callbacks = [];
                }
                return promise;
            },
            // reverse the state of an unfinished promise or forcing a promise to be unfinished; resetting a finished promise clears the callback queue
            rewind: function (count, force) {
                if (!promise.finished && !force) {
                    throw new Error("PromiseLite has not yet been completed; unable to rewind it without force.");
                }
                if (count) {
                    if (count > promise.args.count - promise.tasksLeft) {
                        throw new Error("Unable to rewind a promise by more steps than are completed.");
                    }
                    promise.tasksLeft += count;
                } else {
                    promise.tasksLeft = args.count;
                }
                promise.finished = false;
            }
        };
        promise.task = promise.args.task;
        promise.tasksLeft = promise.args.count;
        return promise;
    };

    Form = function (args) {
        var form;

        args = Utils.getArgs({
            el: undefined, // form element or form container
            validators: undefined, // list of validators to use
            submitApi: undefined,
            submitMethod: 'post',
            successMsg: undefined,
            onSubmit: function () {}, // called on successful submission
            onValidate: function () {} // called on successful validation; allows args to be reformatted
        }, args);
        if (!args.el) {
            throw new Error("An element is required.");
        }

        // having these exteral makes it easier to refer to things elsewhere
        form._sel = {
            item: '.mtar-form-item',
            value: '.mtar-form-value',
            footer: '.mtar-form-footer',
            error: '.mtar-form-error',
            label: '.mtar-form-label',
            generalError: '.mtar-form-general-error',
            generalSuccess: '.mtar-form-general-success',
        }

        // form init and props
        form = {
            args: args,
            el: args.el.tagName === 'FORM' ? args.el : Utils.$1('form', args.el),
            $: function (sel) {
                return Utils.$(sel, form.el);
            },
            $1: function (sel) {
                return $1(sel, form.el);
            }
        };
        if (!form.el) {
            throw new Error("No form element found.");
        }

        // return form field elements
        form.fields = function (args) {
            var wanted = [],
                fields = Utils.$('input, textarea, select', form.el);
            args = Utils.getArgs({
                hidden: true
            }, args);
            fields.forEach(function (field) {
                var type = field.getAttribute('type');
                if (!args.hidden && type && type.toLowerCase() === 'hidden') {
                    return;
                }
                wanted.push(field);
            });
            return wanted;
        };

        form.reset = function () {
            form.showError();
            form.showSuccess();
            form.fields().forEach(function (field) {
                var selObj,
                    $el = Els(field),
                    fieldType = field.getAttribute('type');
                // handle fetching values based on the type
                if (fieldType === 'hidden') {
                    // do nothing!
                } else if (fieldType) {
                    fieldType = fieldType.toLowerCase();
                    if (fieldType === 'checkbox' || fieldType === 'radio') {
                        field.checked = false;
                    } else {
                        field.value = '';
                    }
                } else {
                    field.value = '';
                }
            });
        };

        // returns form data based on the form mode (e.g. ignore disabled inputs; ignore missing optional data)
        form.serialize = function (args) {
            var data = {};
            form.fields(args).forEach(function (field) {
                var selObj,
                    $el = Els(field),
                    value = String(field.value).replace(/^\s+|\s+$/gm, ''),
                    fieldType = field.getAttribute('type'),
                    placeholder = field.getAttribute('mtar-placeholder'),
                    name = field.getAttribute('name'),
                    skip = false;
                // handle fetching values based on the type
                if (fieldType) {
                    fieldType = fieldType.toLowerCase();
                    if (fieldType === 'checkbox') {
                        value = field.checked;
                    } else if (fieldType === 'radio') {
                        skip = true;
                        if (field.checked) {
                            skip = false;
                            value = field.value;
                        } else if (!data.hasOwnProperty(name)) {
                            // make sure we at least record a false value if needed
                            skip = false;
                            value = null;
                        }
                    }
                }
                if (!skip) {
                    if (placeholder && value === placeholder) {
                        value = '';
                    }
                    data[name] = value;
                }
            });
            return data;
        };

        // validate the required form fields based on the mode specified; optionally will show errors
        form.validate = function (args) {
            var $fields = Els(form.fields()),
                data = form.serialize(),
                fieldMap = {},
                errors = {},
                names, name, validated;
            args = Utils.getArgs({
                names: undefined, // only validate the field names given
                showErrors: false, // show inline errors based on validation results
                ignoreEmpty: false // e.g. to show prepopulated field as validated
            }, args);
            // default to validating everything
            if (args.names === undefined || !args.names.length) {
                names = [];
                for (name in data) {
                    if (data.hasOwnProperty) {
                        names.push(name);
                    }
                }
            } else {
                names = args.names;
            }
            $fields.each(function (field) {
                fieldMap[field.getAttribute('name')] = field;
            });
            // for each item listed to validate, fetch any errors
            if (form.args.validators) {
                names.forEach(function (name) {
                    var field, error, validator, $labelEl, label, $field;
                    field = fieldMap[name];
                    $field = Els(field);
                    if ($field.is('[type="hidden"]')) {
                        return;
                    }
                    $labelEl = $field.nearest(Form._sel.label);
                    validator = field.getAttribute('data-validator') || name;
                    // look for a label to get the name; otherwise try fallbacks
                    if (form.args.validators[validator]) {
                        // if we're validating form with pre-populdated info just ignore blank fields
                        if (!data[name] && args.ignoreEmpty) {
                            return;
                        }
                        label = field.getAttribute('data-label') ||
                            ($labelEl.length ? $labelEl[0].innerText : name);
                        error = form.args.validators[validator](
                            data[name],
                            data,
                            label
                        );
                        if (error) {
                            errors[name] = error;
                        }
                    } else if (!$field.is('[type="checkbox"], [type="radio"]')) {
                        Utils.debug("Notice: no validator defined for form input '" + name + "'");
                    }
                });
                if (args.showErrors) {
                    // clear existing general messages first before adding new ones
                    form.showError();
                    form.showSuccess();
                    Els(form.$(Form._sel.error)).each(function (el) {
                        el.parentElement.removeChild(el);
                    });
                    // and now the new (or repeated) ones
                    Utils.each(errors, function (error, name) {
                        // show the error after the form element
                        var parentEl = Els(fieldMap[name]).parents(Form._sel.item),
                            errorEl = form._errorEl(error);
                        if (parentEl.length) {
                            // ideally we'll add the error as the last sibling in the input container
                            parentEl[0].appendChild(errorEl);
                        } else {
                            // no form element node found? just add right after the field then
                            fieldMap[name].parentNode.insertBefore(
                                errorEl, fieldMap[name].nextSibling
                            );
                        }
                    });
                }
            }
            // call the validation callback and let it reformat the data if it returns something truthy
            if (form.args.onValidate) {
                validated = form.args.onValidate(data, errors);
                if (validated) {
                    data = validated;
                }
            }
            return {
                data: data,
                errors: errors
            };
        };

        // show a generic error (e.g. submission errors not tied to a particular input element)
        form.showError = function (error, args) {
            var errorEl;
            args = Utils.getArgs({
                scroll: true
            }, args);
            errorEl = form.$1(Form._sel.generalError);
            // no error? clear the current error
            if (!error) {
                if (errorEl) {
                    errorEl.parentElement.removeChild(errorEl);
                }
            } else {
                // otherwise set the error and scroll to it
                if (!errorEl) {
                    errorEl = document.createElement('div');
                    errorEl.className = Form._sel.generalError.substr(1);
                    form.el.insertBefore(errorEl, form.el.firstChild);
                }
                errorEl.innerHTML = Utils.escape(JSON.stringify(error));
                if (args.scroll) {
                    Els(errorEl).scrollToTop();
                }
            }
        };

        // show a generic error (e.g. submission errors not tied to a particular input element)
        form.showSuccess = function (msg, args) {
            var successEl;
            args = Utils.getArgs({
                scroll: false
            }, args);
            successEl = form.$1(Form._sel.generalSuccess);
            // no error? clear the current error
            if (!msg) {
                if (successEl) {
                    successEl.parentElement.removeChild(successEl);
                }
            } else {
                // otherwise set the error and scroll to it
                if (!successEl) {
                    successEl = document.createElement('div');
                    successEl.className = Form._sel.generalSuccess.substr(1);
                    form.el.insertBefore(successEl, form.el.firstChild);
                }
                successEl.innerHTML = msg;
                if (args.scroll) {
                    Els(successEl).scrollToTop();
                }
            }
        };

        // generate an inline error element
        form._errorEl = function (msg) {
            var el = document.createElement('div');
            el.className = Form._sel.error.substr(1);
            el.innerHTML = msg;
            return el;
        };

        // validate and submit the form
        form.submit = function () {
            var result,
                disabled = [];
            result = form.validate({showErrors: true});
            // validatio errors? just quit!
            if (!Utils.isEmpty(result.errors)) {
                return PromiseLite().complete(false);
            }
            // otherwise disable inputs during submission
            Els(
                form.$('button'),
                form.fields()
            ).each(function (el) {
                // keep track of who we disabled so we can enable them later (w/o enabling previously disabled buttons)
                if (!el.disabled) {
                    el.disabled = true;
                    disabled.push(el);
                }
            });
            return API[form.args.submitMethod](form.args.submitApi, result.data)
                .always(function () {
                    // restore any input/buttons we disabled
                    disabled.forEach(function (el) {
                        el.disabled = false;
                    });
                })
                .then(function (resp) {
                    form.reset();
                    form.args.onSubmit(resp, form, result.data);
                    form.showSuccess(form.args.successMsg);
                    Utils.customEvent(form.el, 'mtar-submitted', {
                        formArgs: form.args,
                        data: result.data
                    });
                })
                .error(function (error) {
                    form.showError(error);
                });
        };

        return form;
    };

    UI = function (args) {
        var ui = {};

        ui.args = Utils.getArgs({
            apiUrl: undefined,
            rootEl: document.body,
        }, args);

        // API wrapper, if wanted
        ui.api = ui.args.apiUrl ? Utils.API(ui.args.apiUrl) : null;

        // UI node caching
        ui.$els = (function () {
            var cache = {};
            
            return function (name, query, args) {
                var els;
                args = Utils.getArgs({
                    clear: false,
                    force: false,
                    expectSome: undefined, // if true, throw an error if we don't find at least one
                    expectOne: undefined, // t if true,hrow an error if we don't find at exactly one
                }, args);
                // just reading what we already expect to be cached?
                if (query === undefined && !args.force) {
                    if (!Utils.has(cache, name)) {
                        throw new Error("No UI element named '" + name + '" has been cached.');
                    }
                    return cache[name];
                }
                if (!query) {
                    throw new Error("Query may not be blank when querying the DOM.");
                }
                // otherwise fetch it, cache it, and wrap in Els
                els = Els(Utils.$(query, ui.args.rootEl));
                if (els.length < 1 && args.expectSome) {
                    throw new Error("Failed to find at least one element matching '" + query + "'");
                }
                if (els.length !== 1 && args.expectOne) {
                    throw new Error("Failed to find exactly one element matching '" + query + "'");
                }
                if (args.clear) {
                    cache = {};
                }
                cache[name] = els;
                return cache[name];
            };
        })();

        return ui;
    };

    return {
        API: API,
        Els: Els,
        Form: Form,
        PromiseLite: PromiseLite,
        Utils: Utils,
        UI: UI,
        XHR: XHR
    };
})();


