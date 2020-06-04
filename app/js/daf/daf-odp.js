/*!
* Data Aquarium Framework - Offline Data Processor
* Copyright 2017-2018 Code On Time LLC; Licensed MIT; http://codeontime.com/license
*/

(function () {
    var _app = $app,
        _odp,
        _window = window,
        _controllers = {},
        Int32_MaxValue = 2147483647,
        dateTimeFormat = Sys.CultureInfo.CurrentCulture.dateTimeFormat,
        numberFormat = Sys.CultureInfo.CurrentCulture.numberFormat,
        PopulatingStaticItems,
        executeCompressedProperties = [
            { _m: 'GetPage', _r: 'request', Me: ['SortExpression', 'FilterIsExternal', 'LookupContextFieldName', 'LookupContextController', 'LookupContextView', 'LookupContext', 'Inserting', 'LastCommandName', 'DoesNotRequireData', 'LastView', 'RequiresFirstLetters', 'SupportsCaching', 'SystemFilter', 'RequiresRowCount', 'RequiresPivot', 'PivotDefinitions', 'Filter', 'ExternalFilter', 'SyncKey', 'Tag'] },
            { _m: 'Execute', _r: 'args', Me: ['CommandArgument', 'LastCommandName', 'LastCommandArgument', 'SaveLEVs', 'ContextKey', 'LastView', 'Filter', 'SortExpression', 'SelectedValues', 'ExternalFilter'], Values: ['OldValue', /*'Modified', */'ReadOnly', 'Error'] } // do not compress-out "Modified" property - it is needed to figure the "Value" property on the server
        ],
        DataFieldAggregate = ['None', 'Sum', 'Count', 'Average', 'Max', 'Min'],
        OnDemandDisplayStyle = ['Thumbnail', 'Link', 'Signature'],
        TextInputMode = ['Text', 'Password', 'RichText', 'Note', 'Static'],
        FieldSearchMode = ['Default', 'Required', 'Suggested', 'Allowed', 'Forbidden'],
        filterExpressionRegex = /([\w\,\.]+):([\s\S]*)/, // (Alias)(Values)
        matchingModeRegex = /^(_match_|_donotmatch_)\:(\$all\$|\$any\$)$/, // (Match)(Scope)
        filterValueRegex = /(\*|\$\w+\$|=|~|<(=|>){0,1}|>={0,1})([\s\S]*?)(\0|$)/; // (Operation)(Value)


    function compressObjectProperty(obj, propList) {
        propList.forEach(function (prop) {
            var v = obj[prop];
            if (prop in obj && (v == null || (v === false && prop != 'OldValue') || v === '' || (Array.isArray(v) && !v.length)))
                delete obj[prop];
        });
    }

    function jsonToData(obj) {
        return JSON.stringify({ d: obj });
    }

    function isWorkingOffline() {
        return _odp.offline() || !_app.online();
    }

    function ActionResult_new(options) {
        var rowsAffected,
            errors = [];
        if (typeof options === 'string')
            errors.push(options);
        else if (Array.isArray(options))
            errors = options;
        else
            rowsAffected = options;
        return {
            "Tag": null,
            "Errors": errors,
            "Values": [
                //{
                //    "Name": "ProductID",
                //    "OldValue": null,
                //    "NewValue": 201,
                //    "Modified": true,
                //    "ReadOnly": false,
                //    "Value": 201,
                //    "Error": null
                //}
            ],
            "Canceled": false,
            "NavigateUrl": null,
            "ClientScript": null,
            "RowsAffected": rowsAffected || 0,
            "Filter": null,
            "SortExpression": null,
            "RowNotFound": false
        };
    }

    _odp = _app.odp = {
        toDataUrl: function (url) {
            // host will either load the image and then resolve the promise with the data url
            // alternatively the promise will resolve right away with the URL pointing straight to the host
            // For example, the second method will return "cloudontime://getblob/?{url: url}" where 38383 is an internal reference to the actual URL
            return $.when(url);
        },
        toOriginalUrl: function (url) {
            // host will format URL into a host-specific URL
            return $.when(url + '&_ticks=' + new Date().getTime());
        },
        download: function (url) {
            // host will download the original file 
            _app.touch.openHref(url);
        },
        blob: function (options) {
            var blobHref = __baseUrl,
                field = options.field,
                onDemandHandler = field.OnDemandHandler,
                crop = options.crop,
                format = options.format || 't',
                key = options.key,
                image = options.image,
                link = options.link,
                deferred = $.Deferred();
            options.href = String.format('{0}blob.ashx?{1}=o|{2}', blobHref, onDemandHandler, key);
            if (link)
                link.attr('data-href', options.href);
            options.src = String.format('{0}blob.ashx?{1}={4}|{2}{3}', blobHref, onDemandHandler, key, crop != true ? '&_nocrop' : '', format);
            if (image) {
                image.attr('src', 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'); // single transparent pixel
                _odp.toDataUrl(options.src).done(function (url) {
                    image.attr('src', url)
                });
            }
            deferred.resolve(options);
            return deferred.promise();
        },
        enabled: function (value) {
            if (arguments.length)
                this._enabled = value == true;
            if (!this._checkedSettings && typeof __settings !== 'undefined') {
                this._checkedSettings = true;
                var odpSettings = __settings && __settings.odp;
                if (odpSettings) {
                    if (odpSettings.enabled == false)
                        this._enabled = false;
                    if (odpSettings.pageSize)
                        _odp._pageSize = odpSettings.pageSize;
                }
            }
            return _app.touch && this._enabled != false;
        },
        offline: function () { return false; },
        get: function (dataView) {
            var instance = null;
            if (_app.touch) {
                var activeDataView = dataView || _app.touch.dataView();
                if (activeDataView) {
                    if (activeDataView._survey)
                        activeDataView = _app.find(activeDataView._survey.parent);
                    if (activeDataView)
                        instance = activeDataView.odp;
                }
            }
            return instance;
        },
        start: function () {
            var odpSettings = __settings.odp;
            _odp.enabled(odpSettings && odpSettings.enabled);
            _odp.controllers = {};
            _odp.functions = {};
            _odp._pk = {};
            _odp._sequence = 0;
            _odp._pendingResponses = {};
            _odp._cache = {}; // general purpose global cache
        },
        response: function (method, response) {
            var pendingResponses = _odp._pendingResponses;
            if (!pendingResponses)
                return null;
            if (arguments.length == 2)
                pendingResponses[method] = response;
            else {
                var response = pendingResponses[method];
                if (response)
                    pendingResponses[method] = null;
                return response;
            }
        },
        invoke: function (dataView, params) {
            var that = this,
                servicePath = dataView.get_servicePath(),
                methodName = params.url.substring(servicePath.length + 1),
                deferred = $.Deferred(),
                odp,
                pendingResponse = _odp.response(methodName),
                prefetchName = '_' + dataView._id + '_prefetch',
                pendingPrefetch = _window[prefetchName],
                runOnServer = true;

            if (pendingPrefetch && methodName == 'GetPage') {
                // replace "]_[/script>]^[" or "]_[script>]^["
                var prefetchJSON = pendingPrefetch.innerHTML.replace(/\]\_\[(\/?script.)\]\^\[/gi, '<$1'),
                    timeStamp = prefetchJSON.match(/\"TimeStamp\"\:\"ts(\d{4}\-\d{2}\-\d{2}T\d{2}\:\d{2}\:\d{2})\"/);
                if (timeStamp)
                    if (dataView.pageProp(prefetchName) == timeStamp[1])
                        prefetchJSON = null;
                    else
                        dataView.pageProp(prefetchName, timeStamp[1]);
                $(pendingPrefetch).remove();

            }
            if (prefetchJSON)
                deferred.resolve(prefetchJSON);
            else if (pendingResponse)
                deferred.resolve(pendingResponse);
            else {

                // compress method argument data properties
                executeCompressedProperties.forEach(function (compressInfo) {
                    if (JSON && compressInfo._m == methodName)
                        for (var prop in compressInfo) {
                            var data = params.data;
                            if (compressInfo._r)
                                data = data[compressInfo._r];
                            if (data && !prop.match(/^_/)) {
                                if (prop != 'Me')
                                    data = data[prop];
                                if (data)
                                    if (Array.isArray(data))
                                        data.forEach(function (item) {
                                            compressObjectProperty(item, compressInfo[prop]);
                                        });
                                    else
                                        compressObjectProperty(data, compressInfo[prop]);
                            }
                        }
                });

                /*
        var filterSource = dataView._filterSource,
        parent, master, masterField;
        if (filterSource) {
        master = _app.find(filterSource);
        if (master) {
            parent = dataView._dataViewFieldName ? dataView : dataView.get_parentDataView();
            if (parent) {
                masterField = master.findField(parent._dataViewFieldName);
                if (masterField)
                    notification = masterField.HeaderText + ': ' + notification;
            }
        }
        }
                */
                if (_app.odp.enabled()) {
                    odp = dataView.odp;
                    // assign an Offline Data Processor instance to all members of modal hierarchy
                    if (!odp && methodName == 'GetPage') {
                        var enabled = dataView.tagged(/\odp\-enabled\-(\w+)\b/)
                        enabled = enabled ? enabled[1] : 'auto';
                        if (enabled != 'none') {
                            if (dataView._dataViewFieldParentId) {
                                var master = _app.find(dataView._filterSource);
                                if (master)
                                    odp = master.odp;
                            }
                            else {
                                var parent = dataView.get_parentDataView();
                                if (parent) {
                                    if (dataView._filterSource)
                                        odp = parent.odp;
                                    if (!odp)
                                        if (parent.odp)
                                            odp = parent.odp;
                                        else {
                                            odp = new _app.OfflineDataProcessor(dataView);
                                            odp._enabled = enabled;
                                        }
                                }
                            }
                            if (!odp && dataView._isModal) {
                                var currentDataView = $app.touch.dataView();
                                if (currentDataView)
                                    odp = currentDataView.odp;
                            }
                        }
                        dataView.odp = odp;
                    }
                    // execute request locally when needed and skip execution on the server
                    if (odp && odp.invoke({ method: methodName, dataView: dataView, params: params, deferred: deferred }))
                        runOnServer = false;
                }
                if (runOnServer) {
                    params.data = _app.toAjaxData(params.data);
                    $.ajax(params).done(function (result) {
                        deferred.resolve(result);
                    }).fail(function (jqXHR, textStatus, error) {
                        deferred.reject(jqXHR, textStatus, error);
                    });
                }
            }
            return deferred.promise();
        },
        verify: function (dataView) {
            var odp = dataView.odp;
            if (odp)
                if (odp.root(dataView) && odp.enabled()) {
                    var hasDataViewFields;
                    $(dataView._fields).each(function () {
                        if (this.Type == 'DataView') {
                            hasDataViewFields = true;
                            return false;
                        }
                    });
                    if (!hasDataViewFields)
                        dataView.odp = null;
                }
                else if (dataView.get_isForm() && !dataView._filterSource && odp.root() != dataView)
                    dataView.odp = new _app.OfflineDataProcessor(dataView, odp);
        },
        getControllers: function (controllers) {
            if (!Array.isArray(controllers))
                controllers = [controllers];

            var missing = [],
                deferred = $.Deferred(),
                cachedControllers = _odp.controllers;

            function resolve() {
                var configList = [];
                controllers.forEach(function (controller) {
                    configList.push(cachedControllers[controller]);
                });
                deferred.resolve(configList);
            }

            controllers.forEach(function (controller) {
                if (!cachedControllers[controller])
                    missing.push(controller);
            })
            if (missing.length)
                $.ajax({
                    url: __servicePath + '/getcontrollerlist',
                    method: 'POST',
                    cache: false,
                    dataType: 'text',
                    data: JSON.stringify({ controllers: missing })
                }).done(function (result) {
                    var controllers = JSON.parse(JSON.parse(result).d);
                    controllers.forEach(function (obj) {
                        var dataController = obj.dataController;
                        cachedControllers[dataController.name] = dataController;
                        // create maps of data controller configuratin objects
                        var map = dataController._map = { key: {}, fields: {}, views: {} };
                        var key = dataController.key = [];
                        dataController.fields.forEach(function (f) {
                            map.fields[f.name] = f;
                            if (f.isPrimaryKey) {
                                key.push(f);
                                map.key[f.name] = f;
                            }
                        });
                        dataController.views.forEach(function (v) {
                            map.views[v.id] = v;
                        });
                    });
                    resolve();
                });
            else
                resolve();
            return deferred.promise();
        },
        commit: function (options) {
            var controller = options.controller,
                odp = options.odp,
                log = options.log,
                deferred = $.Deferred(),
                actionResult,
                masterChanged;

            function resolve() {
                deferred.resolve(actionResult);
                var d = options.deferred;
                if (d)
                    d.resolve(jsonToData(actionResult));
            }

            if (log.length) {
                masterChanged = controller == log[0].controller;
                $.ajax({
                    url: __servicePath + '/commit',
                    method: 'POST',
                    cache: false,
                    dataType: 'text',
                    data: JSON.stringify({ log: log })
                }).done(function (result) {
                    result = result ? JSON.parse(result).d : {};
                    _odp._cache = {};
                    if (result.Success) {
                        if (odp)
                            odp._log.splice(0);
                        actionResult = ActionResult_new(1);
                        if (masterChanged && log[0].args.CommandName == 'Insert' && result.Values.length) {
                            var kfv = result.Values[0];
                            if (kfv.Controller == controller)
                                actionResult.Values.push({ Name: kfv.Name, NewValue: kfv.Value });
                        }
                    }
                    else {
                        if (masterChanged && odp)
                            odp._log.splice(0, 1);
                        actionResult = ActionResult_new(result.Errors);
                    }
                    resolve();
                }).fail(function () {
                    actionResult = ActionResult_new('Unable to save changes.');
                    resolve();
                });
            }
            else
                resolve();
            return deferred.promise();
        },
        func: function (text) {
            var result = _odp.functions[text];
            if (!result)
                result = _odp.functions[text] = eval(text);
            return result;
        },
        compare: function (a, b) {
            if (a == null)
                if (b == null)
                    return 0;
                else
                    return -1;
            else
                if (b == null)
                    return 1;
            if (typeof a === 'string')
                a = a.toUpperCase();
            if (typeof b === 'string')
                b = b.toUpperCase();
            if (a < b) return -1;
            if (a > b) return 1;
            return 0;
        },
        filters: {
            _regexCache: {},
            _inrange: function (v, test) {
                // TODO: review and pass a better filter that uses two parameters (startDate and endDate)
                return v == test;
            },
            _like: function (v, test) {
                if (v == null || test == null)
                    return false;
                var re = _odp.filters._regexCache[test],
                    reKey;
                if (!re) {
                    reKey = test;
                    if (test.match(/^\%/)) {

                        test = test.substring(1);
                        if (test.match(/\%$/)) {
                            // %abc%
                            test = test.substring(0, test.length - 1);
                            re = new RegExp(RegExp.escape(test), 'i');
                        }
                        else
                            // %abc
                            re = new RegExp(RegExp.escape(test) + '$', 'i');

                    }
                    else
                        if (test.match(/\%$/)) {
                            test = test.substring(0, test.length - 1);
                            // abc%
                            re = new RegExp('^' + RegExp.escape(test), 'i');
                        }
                        else
                            // abc
                            re = new RegExp('^' + RegExp.escape(test) + '$', 'i');
                    _odp.filters._regexCache[reKey] = re;
                }
                if (typeof v !== 'string')
                    v = v.toString();
                return v.match(re) != null;
            },
            beginswith: function (v, test) {
                if (v == null || test == null)
                    return false;
                if (typeof v !== 'string')
                    v = v.toString();
                if (typeof test !== 'string')
                    test = test.toString();
                v = v.toUpperCase();
                test = test.toUpperCase();
                return v.indexOf(test) == 0;
            },
            doesnotbeginwith: function (v, test) {
                return false;
            },
            contains: function (v, test) {
                return false;
            },
            doesnotcontain: function (v, test) {
                return false;
            },
            endswith: function (v, test) {
                return false;
            },
            doesnotendwith: function (v, test) {
                return false;
            },
            between: function (v, test) {
                return false;
            },
            in: function (v, test) {
                if (v == null)
                    return false;
                if (!Array.isArray(test))
                    test = [test];
                return test.indexOf(v) != -1;
            },
            notin: function (v, test) {
                return !this.in(v, test);
            },
            month1: function (v, test) {
                return false;
            },
            month2: function (v, test) {
                return false;
            },
            month3: function (v, test) {
                return false;
            },
            month4: function (v, test) {
                return false;
            },
            month5: function (v, test) {
                return false;
            },
            month6: function (v, test) {
                return false;
            },
            month7: function (v, test) {
                return false;
            },
            month8: function (v, test) {
                return false;
            },
            month9: function (v, test) {
                return false;
            },
            month10: function (v, test) {
                return false;
            },
            month11: function (v, test) {
                return false;
            },
            month12: function (v, test) {
                return false;
            },
            thismonth: function (v, test) {
                return false;
            },
            nextmonth: function (v, test) {
                return false;
            },
            lastmonth: function (v, test) {
                return false;
            },
            quarter1: function (v, test) {
                return false;
            },
            quarter2: function (v, test) {
                return false;
            },
            quarter3: function (v, test) {
                return false;
            },
            quarter4: function (v, test) {
                return false;
            },
            thisquarter: function (v, test) {
                return false;
            },
            lastquarter: function (v, test) {
                return false;
            },
            nextquarter: function (v, test) {
                return false;
            },
            thisyear: function (v, test) {
                return false;
            },
            nextyear: function (v, test) {
                return false;
            },
            lastyear: function (v, test) {
                return false;
            },
            yeartodate: function (v, test) {
                return false;
            },
            thisweek: function (v, test) {
                return false;
            },
            nextweek: function (v, test) {
                return false;
            },
            lastweek: function (v, test) {
                return false;
            },
            today: function (v, test) {
                return false;
            },
            yesterday: function (v, test) {
                return false;
            },
            tomorrow: function (v, test) {
                return false;
            },
            yesterday: function (v, test) {
                return false;
            },
            past: function (v, test) {
                return false;
            },
            future: function (v, test) {
                return false;
            },
            true: function (v, test) {
                return false;
            },
            false: function (v, test) {
                return false;
            },
            isempty: function (v, test) {
                return v == null;
            },
            isnotempty: function (v, test) {
                return v != null;
            }
        }
    }

    //
    // Implementation of OfflineDataProcessor for local data processing
    //

    function cloneObject(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    _app.OfflineDataProcessor = function (dataView, odp) {
        var that = this;
        that._sequence = _odp._sequence++;
        that._date = new Date();
        that._dataView = dataView;
        that._state = 'inactive';   // state of the ODP instance
        that._data = {};            // array of data objects
        that._log = [];             // log of ExecuteArgs
        that._dataLoadMap = {};     // map of loaded data objects 
        that._dataLoadedKeys = {};  // map of loaded object keys
        that._dataLoadAll = {};     // map of controllers that require the full set of objects
        that._tracking = {};        // map of controllers that have their data tracked by ODP instance
        that._master = odp;
        if (odp) {
            // borrow data loading info from the master ODP instance
            //that._state = odp._state;
            that._dataLoadMap = cloneObject(odp._dataLoadMap);
            that._dataLoadedKeys = cloneObject(odp._dataLoadedKeys);
            that._dataLoadAll = cloneObject(odp._dataLoadAll);
            that._tracking = cloneObject(odp._tracking);
        }
    }

    _app.OfflineDataProcessor.prototype = {
        is: function (value) {
            var that = this;
            if (arguments.length) {
                if (value.match(/^:/)) {
                    if (value == ':dirty')
                        return that._log.length > 0;
                    return (that._state) == value.substring(1);
                }
                else
                    that._state = value;
            }
            else
                return that._state;

        },
        enabled: function () {
            return this._enabled != 'none';
        },
        root: function (value) {
            return arguments.length == 1 ? this._dataView == value : this._dataView;
        },
        invoke: function (data) {
            var that = this,
                master = that._master,
                log = that._log,
                result,
                dataView = data.dataView,
                controller = dataView._controller,
                lastArgs = dataView._lastArgs,
                commandName = lastArgs ? lastArgs.CommandName : '',
                root = that._dataView,
                isRoot = root == dataView,
                method = data.method;

            function packageActionArgs(date) {
                var d = data.params.data,
                    args = d.args;
                args.Date = _app.stringifyDate(arguments.length ? date : new Date());
                args.Sequence = that._sequence;
                return d;
            }

            if (isRoot) {
                if (method == 'GetPage' && dataView.get_lastCommandName() == 'New')
                    that.is('active');
                else if (method == 'Execute' && commandName.match(/^(Insert|Update)$/)) {
                    var masterChanged = commandName == 'Insert';
                    if (log.length || masterChanged) {
                        // commit the log 
                        if (!masterChanged)
                            data.params.data.args.Values.every(function (fv) {
                                var result = true;
                                if (fv.Modified) {
                                    masterChanged = true;
                                    result = false;
                                }
                                return result;
                            });
                        if (masterChanged)
                            log.splice(0, 0, packageActionArgs(that._date));
                        // clone the log in case if need to preserve the original
                        log = JSON.parse(JSON.stringify(log));
                        if (master) {
                            // commit data locally in master ODP instance
                            master.is('active');
                            var executeDeferredList = [];

                            function commitToMaster() {
                                log.forEach(function (actionData) {
                                    var actionArgs = actionData.args,
                                        actionController = actionData.controller,
                                        deferred = $.Deferred(),
                                        executeData = { deferred: deferred, method: 'Execute', params: { data: actionData } };
                                    actionArgs.Sequence = master._sequence;
                                    executeDeferredList.push(deferred.promise());
                                    master.tracking(actionController, true);
                                    if (actionArgs.CommandName == 'Insert')
                                        master.execute(executeData);
                                    else
                                        $.when(master.getData(actionController, actionArgs.ExternalFilter)).done(function () {
                                            master.execute(executeData);
                                        });
                                });
                                $.when.apply($, executeDeferredList).done(function () {
                                    var masterActionData = masterChanged ? arguments[0] : jsonToData(ActionResult_new(1)),
                                        masterActionResult = JSON.parse(masterActionData).d;
                                    if (!masterActionResult.Errors.length) {
                                        //that.is('committed');
                                        log.forEach(function (actionData) {
                                            master._log.push(actionData);
                                        });
                                        data.deferred.resolve(masterActionData);
                                    }
                                });
                            }

                            // get the master controller configuration
                            if (masterChanged)
                                $.when(_odp.getControllers(controller)).done(commitToMaster);
                            else
                                commitToMaster();
                        }
                        else
                            // commit data on the server
                            _odp.commit({
                                log: log,
                                odp: that,
                                controller: controller,
                                deferred: data.deferred
                            });
                        return true;
                    }
                    else
                        return false; // execute request on the server
                }
            }
            else {
                if (method == 'Execute' && commandName.match(/^(Insert|Update|Delete)$/)) {
                    that.is('active');
                    log.push(packageActionArgs());
                    that.tracking(controller, true);
                    if (!dataView._filterSource && that._dataLoadAll[controller] == null)
                        that._dataLoadAll[controller] = true;
                }
                else
                    if (method == 'GetPage' && root.inserting()) {
                        var master = dataView;
                        while (master && master._filterSource)
                            master = _app.find(master._filterSource);
                        if (master && master != dataView && master.inserting())
                            that.tracking(controller, true);
                    }
            }
            if (method.match(/^(GetPage|Execute|GetListOfValues)$/) && that.tracking(dataView)) {
                $.when(_odp.getControllers(controller)).done(function () {
                    if (root.inserting() && method == 'GetPage' && !data.params.data.request.ExternalFilter && !that._dataLoadAll[controller])
                        that._dataLoadAll[controller] = true;
                    $.when(that.ensureData(controller, method)).done(function () {
                        if (root.inserting() || method == 'Execute' && commandName == 'Insert')
                            that.execute(data);
                        else
                            $.when(that.getData(controller, dataView.get_externalFilter())).done(function () {
                                that.execute(data);
                            });
                    });
                });
                result = true;
            }
            return !!result;
        },
        tracking: function (controller) {
            if (typeof controller !== 'string')
                controller = controller._controller;
            var trackingMap = this._tracking;
            if (arguments.length == 1)
                return !!trackingMap[controller];
            else
                trackingMap[controller] = arguments[1];

        },
        ensureData: function (controller, method) {
            var that = this,
                deferred = $.Deferred();
            if (method != 'Execute' && that._dataLoadAll[controller])
                that.getData(controller).done(function () {
                    deferred.resolve();
                });
            else
                deferred.resolve();
            return deferred.promise();
        },
        _borrowData: function (controller) {
            var that = this,
                master = that._master;
            if (master && !that._data[controller] && master._data[controller])
                that._data[controller] = cloneObject(master._data[controller]);
        },
        getData: function (controller, externalFilter) {
            var that = this,
                master = that._master,
                deferred = $.Deferred(),
                rowCount,
                loadMapKey, cacheKey, cache,
                dataLoadMap = that._dataLoadMap[controller],
                pageIndex = 0;

            function resolve() {
                if (loadMapKey == '_all')
                    that._dataLoadAll[controller] = false;
                var data = that._data[controller];
                deferred.resolve(data);
            }

            function loadPage(pageIndex) {
                var pageSize = _odp._pageSize || 100;
                _app.execute({
                    controller: controller,
                    view: 'offline',
                    pageSize: pageSize,
                    pageIndex: pageIndex,
                    requiresRowCount: pageIndex == 0,
                    externalFilter: externalFilter,
                    odp: false,
                    nativeDates: false
                }).done(function (result) {
                    var data = result[controller];
                    // cache serialized data globally
                    if (!cache)
                        cache = _odp._cache[cacheKey] = [];
                    cache.push(JSON.stringify(data));
                    // add data to the local instance
                    if (pageIndex == 0)
                        rowCount = result.totalRowCount;
                    that.addData(controller, data);
                    rowCount -= pageSize;
                    if (rowCount < 0)
                        resolve();
                    else
                        loadPage(pageIndex + 1);
                });
            }
            that._borrowData(controller);

            if (!dataLoadMap)
                dataLoadMap = that._dataLoadMap[controller] = {}
            loadMapKey = externalFilter && externalFilter.length ? JSON.stringify(externalFilter) : '_all';
            cacheKey = controller + '$' + loadMapKey;
            if (!dataLoadMap['_all'] && !dataLoadMap[loadMapKey]) {
                dataLoadMap[loadMapKey] = true;
                cache = _odp._cache[cacheKey];
                if (cache) {
                    rowCount = 0;
                    cache.forEach(function (data) {
                        data = JSON.parse(data);
                        rowCount += data.length;
                        that.addData(controller, data);
                    });
                    resolve();
                }
                else
                    loadPage(0);
            }
            else
                resolve();

            return deferred.promise();
        },
        addData: function (controller, data) {
            var that = this,
                pk = _odp.controllers[controller].key,
                loadedKeys = that._dataLoadedKeys[controller],
                list = that._data[controller];
            if (!loadedKeys)
                loadedKeys = that._dataLoadedKeys[controller] = {};
            if (!list)
                list = that._data[controller] = [];
            data.forEach(function (obj) {
                var key = [];
                pk.forEach(function (k) {
                    key.push(obj[k.name]);
                });
                key = key.join(',');
                if (!loadedKeys[key]) {
                    loadedKeys[key] = true;
                    list.push(obj);
                }
            });
        },
        execute: function (options) {
            var that = this,
                method = options.method,
                methodArgs = options.params.data,//JSON.parse(htmlDecode(options.params.data)),
                args = methodArgs.args,
                request = methodArgs.request,
                values = args ? args.Values : null,
                config = _odp.controllers[methodArgs.controller],
                controllerName = config.name,
                commandName = args ? args.CommandName : null,
                map = config._map,
                keyFilter = [], params = {}, paramCount = 0,
                objects;

            function resolve(result) {
                options.deferred.resolve(jsonToData(result));
            }

            that._borrowData(controllerName);

            if (method == 'Execute') {
                var actionResult = ActionResult_new();
                // translate values into filter expression
                if (commandName == 'Update' || commandName == 'Delete') {
                    // there is no need for conflict detection - always use only the primary key fields
                    values.forEach(function (fv) {
                        if (map.key[fv.Name]) {
                            if (keyFilter.length)
                                keyFilter.push('&&');
                            keyFilter.push('(this.' + fv.Name + '==params.p' + paramCount + ')');
                            params['p' + paramCount++] = fv.OldValue;
                        }
                    });
                    that.select({ from: controllerName, where: { filter: keyFilter.toString(), params: params }, limit: 1, remove: commandName == 'Delete' }).done(function (result) {
                        // process values and update the item for "Update" command
                        var obj = result[0];
                        if (obj && commandName == 'Update')
                            values.forEach(function (fv) {
                                if (fv.Modified)
                                    obj[fv.Name] = fv.NewValue;
                            });
                        actionResult.RowsAffected = result.length;
                        actionResult.RowNotFound = result.length == 0;
                        resolve(actionResult);
                    });
                }
                else if (commandName == 'Insert') {
                    // insert a new row but check for duplicates
                    var newObj = {},
                        objects = that._data[controllerName],
                        statusField = map.fields['Status'];
                    values.forEach(function (fv) {
                        if (fv.Name != 'Status' || statusField)
                            newObj[fv.Name] = fv.NewValue;
                    });
                    if (!objects)
                        objects = that._data[controllerName] = [];
                    objects.push(newObj);
                    actionResult.RowsAffected = 1;
                    for (var pkName in map.key)
                        if (newObj[pkName] == null) {
                            // generate a new primary key and alter the log
                            var pkValue = _odp._pk[controllerName];
                            if (pkValue == null)
                                pkValue = _odp._pk[controllerName] = 0;
                            pkValue--;
                            _odp._pk[controllerName] = pkValue;
                            if (map.key[pkName].type.match(/(Guid|String)/))
                                pkValue = pkValue.toString();
                            newObj[pkName] = pkValue;
                            actionResult.Values.push({ Name: pkName, Value: pkValue })
                            var keyFieldValue;
                            values.every(function (fv) {
                                if (fv.Name == pkName) {
                                    fv.NewValue = pkValue;
                                    fv.Modified = true;
                                    keyFieldValue = fv;
                                }
                            });
                            if (!keyFieldValue)
                                values.push({ Name: pkName, Value: pkValue, Modified: true });
                            break;
                        }
                    resolve(actionResult);
                }
                else if (commandName == 'Calculate')
                    if (config.calculateOnServer && !isWorkingOffline()) {
                        var params = options.params;
                        params.data = _app.toAjaxData(params.data);
                        $.ajax(params).done(function (result) {
                            actionResult = JSON.parse(result).d;
                            resolve(actionResult);
                        }).fail(function (jqXHR, textStatus, error) {
                            resolve(actionResult);
                        });
                    }
                    else
                        resolve(actionResult);
                else if (commandName == 'PopulateDynamicLookups') {
                    resolve(actionResult);
                }
                else
                    _app.alert('Unsupported command ' + commandName, function () {
                        resolve(actionResult);
                    });
            }
            else if (method == 'GetPage') {
                var pageRequest = methodArgs.request;
                pageRequest.Controller = methodArgs.controller;
                pageRequest.View = methodArgs.view;
                that._viewPage(pageRequest).done(function (page) {
                    delete page._fieldMap;
                    delete page._metadataFilter;
                    resolve(page);
                });
            }
            else if (method == 'GetListOfValues') {
                var getListOfValuesRequest = methodArgs.request;
                getListOfValuesRequest.Controller = methodArgs.controller;
                getListOfValuesRequest.View = methodArgs.view;
                getListOfValuesRequest.Distinct = true;
                getListOfValuesRequest.PageSize = Number.MAX_VALUE;
                getListOfValuesRequest.PageIndex = 0;
                var distinctValueFieldName = getListOfValuesRequest.FieldName;
                getListOfValuesRequest.FieldFilter = [distinctValueFieldName];
                getListOfValuesRequest.MetadataFilter = ['fields'];
                getListOfValuesRequest.DoesNotRequireAggregates = true;
                getListOfValuesRequest.SortExpression = distinctValueFieldName;
                that._viewPage(getListOfValuesRequest).done(function (page) {
                    var listOfValues = [];
                    page.Rows.every(function (r) {
                        listOfValues.push(r[0]);
                        return listOfValues.length < 1000;
                    });
                    resolve(listOfValues);
                });
            }
            else
                _app.alert('Unknown method: ' + method);

        },
        select: function (options) {
            var that = this,
                deferred = $.Deferred(),
                from = options.from,
                where = options.where,
                filter = where ? where.filter : null,
                sort = options.sort,
                objects = typeof from === 'string' ? (that._data[from] || []) : from, result = [], toRemove = [],
                indexes = options.index ? [] : null,
                filterFunc;
            if (options.yield)
                result = options.yield;
            else {
                // filter
                if (filter) {
                    filterFunc = _odp.func('(function(params,rowIndex){return ' + filter + '})');
                    for (var i = 0; i < objects.length; i++) {
                        var obj = objects[i];
                        if (filterFunc.call(obj, where.params, i + 1)) {
                            result.push(obj);
                            if (indexes)
                                indexes.push(i + 1);
                            if (options.remove)
                                toRemove.push(i);
                            if (options.limit == result.length)
                                break;
                        }
                    }
                    for (i = toRemove.length - 1; i >= 0; i--)
                        objects.splice(toRemove[i], 1);
                }
                else
                    result = objects.slice(0);
                // sort
                if (sort)
                    result.sort(_odp.func(that._sortFunc(sort)));
            }
            // complete
            deferred.resolve(result, indexes);
            return deferred.promise();
        },
        key: function (dataView) {
            var that = this,
                key = [],
                controller = dataView._controller,
                row = dataView.inserting() ? dataView._newRow : dataView._rows[0];
            if (row) {
                dataView._keyFields.forEach(function (pkField) {
                    var fieldType = pkField.Type,
                        fieldIndex = pkField.Index;
                    if (fieldType != 'String' || pkField.Len == 36) {
                        var pkValue = row[fieldIndex];
                        if (pkValue == null) {
                            pkValue = _odp._pk[controller];
                            if (pkValue == null)
                                pkValue = _odp._pk[controller] = 0;
                            pkValue--;
                            _odp._pk[controller] = pkValue;
                            if (fieldType.match(/(Guid|String)/))
                                pkValue = pkValue.toString();
                            row[fieldIndex] = pkValue;
                        }
                    }
                    key.push(row[pkField.Index]);
                });
            }
            return key;
        },
        _sortFunc: function (sort) {
            var func = ['(function(a,b){'],
                iterator = /(\w+)(\s+(asc|desc))?/ig,
                m, first = true;
            func.push('var result=0;');
            while (m = iterator.exec(sort)) {
                if (first)
                    first = false;
                else
                    func.push('if (result != 0) return result;');
                func.push(String.format('result = ($app.odp.compare(a.{0},b.{0}))', m[1]));
                if (m[3] && m[3].match(/^desc/i))
                    func.push('if (result != 0) result *=-1;');
            }
            func.push('return result;');
            func.push('})');
            return func.join('\n');
        },
        _filterFunc: function (filter) {
            var func = ['(function(a,b){'];
            func.push('})');
            func = func.join('\n');
            return func;
        },
        _viewPage: function (request) {
            // DEBUG -----------------------------
            // request.View = 'editForm1';
            // END DEBUG -------------------------
            var odp = this,
                page = {}, pageDeferred = $.Deferred(),
                controller = request.Controller,
                config,
                viewId = request.View,
                view;

            function selectView() {
                config = _odp.controllers[controller];
                view = viewId ? config._map.views[viewId] : config.views[0];
            }

            function PageRequest_assignContext(view) {
                var that = this;
                if (that.PageSize == 1000 && !that.SortExpression)
                    // we are processing a request to retreive static lookup data
                    that.SortExpression = view.sortExpression;
            }

            //function ViewPage_resetSkipCount(preFetch) {
            //    var that = this;
            //    that._readCount = Number.MAX_VALUE;
            //    that._skipCount = 0;
            //    if (preFetch) {
            //        that._skipCount = (that.PageIndex - 1) * that.PageSize;
            //        that._readCount = that._readCount * 3;
            //        if (that._skipCount < 0) {
            //            that._skipCount = 0;
            //            that._readCount = that._readCount * that._pageSize;
            //        }
            //    }
            //    else
            //        that._skipCount = that.PageIndex * that.PageSize;
            //}

            function ViewPage_new(request) {
                var that = this;
                that.Tag = request.Tag;
                that.DistinctValueFieldName = request.FieldName;
                that.PageOffset = request.PageOffset || 0;
                that.RequiresMetaData = request.PageIndex == -1 || request.RequiresMetaData;
                that.RequiresRowCount = request.PageIndex < 0 || request.RequiresRowCount;
                that.PageIndex = 0;
                if (request.PageIndex == -2)
                    request.PageIndex = 0;
                that.PageSize = request.PageSize;
                if (request.RequiresPivot) {
                    that.RequiresPivot = true;
                    that.RequiresMetaData = false;
                    that.RequiresRowCount = false;
                    that.PageSize = Number.MAX_VALUE;
                    // assign pivot definitions
                }
                if (request.PageIndex > 0)
                    that.PageIndex = request.PageIndex;
                that.Rows = [];
                that.Fields = [];
                //ViewPage_resetSkipCount.call(that, false)
                //that._readCount = that.PageSize;
                that.SortExpression = request.SortExpression;
                that.GroupExpression = request.GroupExpression;
                that.Filter = request.Filter;
                that.SystemFilter = request.SystemFilter;
                that.TotalRowCount = -1;
                that.Views = [];
                that.ActionGroups = [];
                that.Categories = [];
                that.Controller = request.Controller;
                that.View = request.View;
                that.LastView = request.LastView;
                that.ViewType = request.ViewType;
                that.SupportsCaching = request.SupportsCaching;
                that.QuickFindHint = request.QuickFindHint;
                that.InnerJoinPrimaryKey = request.InnerJoinPrimaryKey;
                that.InnerJoinForeignKey = request.InnerJoinForeignKey;
                that.RequiresSiteContentText = request.RequiresSiteContentText;
                //that._disableJSONCompatibility = request.DisableJSONCompatibility;
                that.FieldFilter = request.FieldFilter;
                //that._requestedFieldFilter = request.FieldFilter;
                that._metadataFilter = request.MetadataFilter;
                that.Distinct = request.Distinct;
                var staticLookupViewTypeFilter = 'Form',
                    tag = request.Tag;
                if (tag && tag.match(/\bview\-type\-inline\-editor\b/))
                    staticLookupViewTypeFilter = 'Grid';
                that._staticLookupViewTypeFilter = staticLookupViewTypeFilter;
            }

            function ViewPage_includeMetadata(name) {
                var metadataFilter = this._metadataFilter;
                return metadataFilter == null || metadataFilter.indexOf(name) != -1;
            }

            function ViewPage_enumerateSyncFields() {
                var page = this,
                    keyFields = [];
                if (!page.Distinct)
                    page.Fields.forEach(function (df) {
                        if (df.IsPrimaryKey)
                            keyFields.push(df);
                    });
                return keyFields;
            }

            function ControllerConfiguration_AssignDynamicExpressions(page) {
                var that = this,
                    expressions = page.Expressions = [];
                if (ViewPage_includeMetadata.call(page, 'expressions')) {
                    // TODO - enumerate a list of expressions
                    config.expressions.forEach(function (de) {
                        if (de.ViewId == null || de.ViewId == page.View)
                            expressions.push(de);
                    });
                }
            }

            function DataField_IsMatchedByName(sample) {
                var that = this,
                    headerText = that.HeaderText || that.Label || that.Name;
                headerText = headerText.replace(/\s/g, '');
                sample = new RegExp('^' + RegExp.escape(sample.replace(/\s/g, '')), 'i');
                return headerText.match(sample);

            }

            function populatePageCategories(page) {
                var categories = view.categories || [];
                categories.forEach(function (c, index) {
                    page.Categories.push({
                        Id: c.id,
                        Index: index,
                        HeaderText: c.headerText,
                        Description: c.description ? c.description['@value'] : null,
                        Tab: c.tab,
                        Wizard: c.wizard,
                        Flow: c.flow,
                        Wrap: c.wrap == true,
                        Floating: c.floating == true,
                        Collapsed: c.collpased == true
                    });
                });
                if (!categories.length)
                    page.Categories.push({ Id: null, Index: 0 });
            }

            function appendDeepFilter(hint, page, sb, deepFilterExpression) {
                // TBD
            }

            function stringToValue(s) {
                var v = s,
                    values, isArray;
                if (s != null) {
                    if (typeof s === 'string') {
                        values = s.split(/(?:\$(?:and|or)\$)/g);
                        isArray = values.length > 1;
                    }
                    else
                        values = [s];
                    for (var i = 0; i < values.length; i++) {
                        s = values[i];
                        if (s != null && s.match(/^%js%/))
                            values[i] = JSON.parse(s.substring(4));
                    }
                    v = isArray ? values : values[0];
                }
                return v;
            }

            function stringIsNull(s) {
                return s == 'null' || s == '%js%null';
            }

            function toWhere(request, page) {
                var filter = [],
                    params = {}, paramCount = 0,
                    quickFindHint = page.QuickFindHint,
                    firstCriteria = true,
                    matchListCount = 0,
                    firstDoNotMatch = true,
                    logicalConcat = '&&',
                    useExclusiveQuickFind = false,
                    pageFilter = page.Filter,
                    sb = [];
                page.Fields.every(function (df) {
                    var searchOptions = df.SearchOptions;
                    if (searchOptions && searchOptions.match(/\$quickfind(?!disabled)/)) {
                        useExclusiveQuickFind = true;
                        return false;
                    }
                });
                if (pageFilter)
                    pageFilter.forEach(function (filterExpression) {
                        // test matching mode
                        var matchingMode = filterExpression.match(matchingModeRegex);
                        if (matchingMode) {
                            var doNotMatch = matchingMode[1] == '_donotmatch_';
                            if (doNotMatch) {
                                if (firstDoNotMatch) {
                                    firstDoNotMatch = false;
                                    if (!firstCriteria)
                                        sb.push(')\n');
                                    if (matchListCount > 0)
                                        sb.push(')\n');
                                    if (!firstCriteria || matchListCount > 0)
                                        sb.push('&&\n'); // and
                                    matchListCount = 0;
                                    sb.push(' !\n'); // not
                                    firstCriteria = true;
                                }
                            }
                            if (matchListCount == 0) {
                                if (!firstCriteria)
                                    sb.push(') &&\n'); // and
                                sb.push('(\n');
                            }
                            else {
                                sb.push(')\n');
                                sb.push('||\n'); // or
                            }
                            // begin a list of conditions for the next match
                            if (matchingMode[2] == '$all$')
                                logicalConcat = ' && '; // and
                            else
                                logicalConcat = ' || '; // or
                            matchListCount++;
                            firstCriteria = true;
                        }
                        // test filter expression
                        var filterMatch = filterExpression.match(filterExpressionRegex);
                        if (filterMatch) {
                            var firstValue = true;
                            var fieldOperator = ' || '; // or
                            if (filterMatch[2].match(/>\|</))
                                fieldOperator = ' && '; // and
                            var valueMatch = filterMatch[2].match(filterValueRegex);
                            if (valueMatch) {
                                var alias = filterMatch[1];
                                var operation = valueMatch[1];
                                var paramValue = valueMatch[3];
                                if (operation == '~' && alias == '_quickfind_')
                                    alias = page.Fields[0].Name;
                                var deepSearching = alias.match(/,/);
                                var field = page._fieldMap[alias];
                                if (((field != null && field.AllowQBE != false || operation == "~") && (((page.DistinctValueFieldName != field.Name || matchListCount > 0) || (operation == "~")) || (page.AllowDistinctFieldInFilter /*|| page.CustomFilteredBy(field.Name)*/))) || deepSearching) {
                                    if (firstValue) {
                                        if (firstCriteria) {
                                            sb.push('(\n');
                                            firstCriteria = false;
                                        }
                                        else
                                            sb.push(logicalConcat);
                                        sb.push('(');
                                        firstValue = false;
                                    }
                                    else
                                        sb.push(fieldOperator);
                                    if (deepSearching) {
                                        var deepSearchFireldName = alias.substring(0, alias.indexOf(','));
                                        var hint = alias.substring(deepSearchFireldName.length + 1);
                                        var deepFilterExpression = deepSearchFireldName + filterExpression.indexOf(':');
                                        appendDeepFilter(hint, page, sb, deepFilterExpression);
                                    }
                                    else if (operation == '~') {
                                        paramValue = stringToValue(paramValue);
                                        var words = [];
                                        var phrases = [words];
                                        var removableNumericCharactersRegex = new RegExp(RegExp.escape(numberFormat.NumberGroupSeparator + numberFormat.CurrencyGroupSeparator + numberFormat.CurrencySymbol), 'gi');
                                        var textDateNumber = /*'\\p{L}\\d'*/ Unicode.w + RegExp.escape(dateTimeFormat.DateSeparator + dateTimeFormat.TimeSeparator + numberFormat.NumberDecimalSeparator);
                                        // (Token((Quote)(Value))|((Quote)(Value)|(())|(Value))
                                        //    1       3     4         6       7          10
                                        // Token (1), Quote (3, 6), Value (4, 7, 10)
                                        var quickFindRegex = new RegExp("\\s*(((\")(.+?)\")|((\\\')(.+?)\\\')|(,|;|(^|\\s+)-)|([" + textDateNumber + "]+))", 'gi');
                                        var m = quickFindRegex.exec(paramValue);
                                        var negativeSample = false;
                                        while (m) {
                                            var token = m[1].trim();
                                            if (token == ',' || token == ';') {
                                                words = [];
                                                phrases.push(words);
                                                negativeSample = false;
                                            }
                                            else
                                                if (token == '-')
                                                    negativeSample = true;
                                                else {
                                                    var exactFlag = '=';
                                                    if (!(m[3] || m[6]))
                                                        exactFlag = ' ';
                                                    var negativeFlag = ' ';
                                                    if (negativeSample) {
                                                        negativeFlag = '-';
                                                        negativeSample = false;
                                                    }
                                                    var value = m[4];
                                                    if (value == null)
                                                        value = m[7];
                                                    if (value == null)
                                                        value = m[10];
                                                    words.push(negativeFlag + exactFlag + value);
                                                }
                                            m = quickFindRegex.exec(paramValue);
                                        }
                                        var firstPhrase = true;
                                        phrases.forEach(function (phrase) {
                                            if (firstPhrase)
                                                firstPhrase = false;
                                            else
                                                sb.push('||\n'); // or
                                            sb.push('(\n');
                                            var firstWord = true;
                                            phrase.forEach(function (paramValueWord) {
                                                var negativeFlag = paramValueWord.charAt(0) == '-';
                                                var exactFlag = paramValueWord.charAt(1) == '=';
                                                var comparisonOperator = 'like';
                                                if (exactFlag)
                                                    comparisonOperator = '=';
                                                var pv = paramValueWord.substring(2);
                                                var fieldNameFilter;
                                                var complexParam = pv.match(/^(.+)\:(.+)$/);
                                                if (complexParam) {
                                                    fieldNameFilter = complexParam[1];
                                                    var fieldIsMatched = false;
                                                    page.Fields.every(function (tf) {
                                                        if (tf.AllowQBE != false && !tf.AliasName || !(tf.IsPrimaryKey && tf.Hidden && DataField_IsMatchedByName.call(tf))) {
                                                            fieldIsMatched = true;
                                                            return;
                                                        }
                                                    });
                                                    if (fieldIsMatched)
                                                        pv = complexParam[2];
                                                    else
                                                        fieldNameFilter = null;
                                                }
                                                var paramValueAsDate = Date.tryParseFuzzyDate(pv);
                                                var paramValueIsDate = paramValueAsDate != null;
                                                var firstTry = true;
                                                var parameter;
                                                var paramValueAsNumber;
                                                var testNumber = pv;
                                                testNumber = testNumber.replace(removableNumericCharactersRegex, '');
                                                paramValueAsNumber = parseFloat(testNumber);
                                                var paramValueIsNumber = !isNaN(paramValueAsNumber);
                                                if (!exactFlag && !pv.match(/%/))
                                                    pv = '%' + pv + '%';
                                                if (firstWord)
                                                    firstWord = false;
                                                else
                                                    sb.push('&&'); // and
                                                if (negativeFlag)
                                                    sb.push('!'); // not
                                                sb.push('(');
                                                var hasTests = false;
                                                var originalParameter;
                                                if (!quickFindHint || !quickFindHint.match(/^;/))
                                                    page.Fields.forEach(function (tf) {
                                                        var searchOptions = tf.SearchOptions;
                                                        if (tf.AllowQBE != false && !tf.AliasName && !(tf.IsPrimaryKey && tf.Hidden && (!tf.Type.match(/^Date/) || paramValueIsDate))) {
                                                            if (!fieldNameFilter || DataField_IsMatchedByName.call(tf, fieldNameFilter))
                                                                if ((!useExclusiveQuickFind && !searchOptions || !searchOptions.match(/\$quickfinddisabled/)) || (useExclusiveQuickFind && !searchOptions && searchOptions.match(/\$quickfind/))) {
                                                                    hasTests = true;
                                                                    if (!parameter) {
                                                                        parameter = 'p' + paramCount++;
                                                                        params[parameter] = pv;
                                                                    }
                                                                    if (exactFlag && paramValueIsNumber)
                                                                        params[parameter] = paramValueAsNumber;
                                                                    if (!(exactFlag && (!tf.Type.match(/String/) && !paramValueIsNumber || (tf.Type.match(/String/) && paramValueIsNumber)))) {
                                                                        if (firstTry)
                                                                            firstTry = false;
                                                                        else
                                                                            sb.push('||'); // or
                                                                        if (tf.Type.match(/^Date/)) {
                                                                            var dateParameter = 'p' + paramCount++;
                                                                            params[dateParameter] = _app.stringifyDate(paramValueAsDate);
                                                                            if (negativeFlag)
                                                                                sb.push('(', tf.Name, ' != null)&&');
                                                                            sb.push('(', tf.Name, ' = ', dateParameter);
                                                                        }
                                                                        else {
                                                                            var skipLike = false;
                                                                            if (comparisonOperator != '=' && tf.Type == 'String' && tf.Len > 0 && tf.Len < pv.length) {
                                                                                var pv2 = pv;
                                                                                pv2 = pv2.substring(1);
                                                                                if (tf.Len < pv2.length)
                                                                                    pv2 = pv2.substring(0, pv2.length - 1);
                                                                                if (pv2.length > tf.Len)
                                                                                    skipLike = true;
                                                                                else {
                                                                                    originalParameter = parameter;
                                                                                    parameter = 'p' + paramCount++;
                                                                                    params[parameter] = pv2;
                                                                                }
                                                                            }
                                                                            if (negativeFlag)
                                                                                sb.push('(this.', tf.Name, '!= null)&&');
                                                                            if (comparisonOperator == '=')
                                                                                sb.push('(this.', tf.Name, '==', 'params.', parameter, ')');
                                                                            else
                                                                                sb.push('$app.odp.filters._like(this.', tf.Name, ',', 'params.', parameter, ')');
                                                                        }
                                                                        if (originalParameter)
                                                                            parameter = originalParameter;
                                                                    }
                                                                }
                                                        }
                                                    });
                                                if (quickFindHint && quickFindHint.match(/\;/)) {
                                                    // inject deep filter here
                                                }
                                                if (!hasTests)
                                                    if (negativeFlag && quickFindHint.match(/^\;/))
                                                        sb.push('1=1');
                                                    else
                                                        sb.push('1=0');
                                                sb.push(')\n');
                                            });
                                            sb.push(')\n');
                                        });
                                        if (firstPhrase)
                                            sb.push('1=1');
                                    }
                                    else
                                        if (operation.match(/^$/)) {
                                            var parameter = 'p' + paramCount++,
                                                paramValue = stringToValue(paramValue);
                                            params[parameter] = paramValue;
                                            sb.push('($app.odp.filters.', operation.substring(operation.length - 1), '(this.', alias, ',params.', parameter, ')');
                                        }
                                        else {
                                            var parameter = 'p' + paramCount++;
                                            params[parameter] = stringToValue(paramValue);
                                            var requiresRangeAdjustment = operation == '=' && field.Type.match(/^DateTime/) && paramValue;
                                            if (operation == '<>' & stringIsNull(paramValue))
                                                sb.push('this.', alias, ' != null');
                                            else
                                                if (operation == '=' && stringIsNull(paramValue))
                                                    sb.push('this.', alias, ' == null');
                                                else {
                                                    var filterFunc = operation;
                                                    if (operation == '*')
                                                        filterFunc = '_like';
                                                    else if (requiresRangeAdjustment)
                                                        filterFunc = '_inrange';
                                                    else if (operation == '<>')
                                                        operation = '!=';
                                                    else if (operation == '=')
                                                        operation = '==';
                                                    if (filterFunc.match(/\$/))
                                                        filterFunc = filterFunc.substring(1, filterFunc.length - 1);
                                                    if (filterFunc in _odp.filters)
                                                        sb.push('$app.odp.filters.', filterFunc, '(this.', alias, ',params.', parameter, ')');
                                                    else
                                                        sb.push('this.', alias, operation + 'params.', parameter);
                                                }
                                        };
                                }
                            }
                        }
                        if (!firstValue)
                            sb.push(')\n');
                    });
                if (matchListCount) {
                    sb.push(')\n');
                    // the end of the match list
                    sb.push(')\n');
                    firstCriteria = true;
                }
                if (!firstCriteria)
                    sb.push(')\n');

                return { filter: sb.join(''), params: params };
            }

            function toSort(page) {
                var sort = page.SortExpression || '';
                var keyFields = ViewPage_enumerateSyncFields.call(page);
                keyFields.forEach(function (f) {
                    if (f.IsPrimaryKey) {
                        if (sort.length)
                            sort += ',';
                        sort += f.Name;
                    }
                });
                return sort;
            }

            function syncRequestedPage(request, page) {
                var deferred = $.Deferred();
                if ((request.SyncKey == null || !request.SyncKey.length) || page.PageSize < 0) {
                    deferred.resolve(page);
                    return deferred.promise();
                }
                configureCommand(page);
                var keyFields = ViewPage_enumerateSyncFields.call(page);
                if (keyFields.length == request.SyncKey.length) {
                    var keyFilter = [],
                        params = {}, paramCount = 0;
                    keyFields.forEach(function (df, index) {
                        if (keyFilter.length)
                            keyFilter.push('&&');
                        keyFilter.push('(this.' + df.Name + '==params.p' + paramCount + ')');
                        params['p' + paramCount++] = request.SyncKey[index];
                    });

                    odp.select({ from: page.Controller, where: toWhere(request, page), sort: toSort(page) }).done(function (sortedAndFilteredObjects) {
                        odp.select({ from: sortedAndFilteredObjects, where: { filter: keyFilter.toString(), params: params }, index: true, limit: 1 }).done(function (objects, indexes) {
                            if (objects.length) {
                                page.PageIndex = Math.floor((indexes[0] - 1) / page.PageSize);
                                page.PageOffset = 0;
                            }
                            deferred.resolve(page, sortedAndFilteredObjects);
                        });
                    });
                }
                else
                    deferred.resolve(page);
                return deferred.promise();
            }

            function configureCommand(page) {
                populatePageFields(page);
                ensurePageFields(page);
                if (!page.SortExpression)
                    page.SortExpression = view.sortExpression;
            }


            function DataField_new(f, hidden) {
                var field = { Name: f.name, Type: f.type };
                if (hidden)
                    field.Hidden = hidden == true;
                if (f.length != null)
                    field.Len = f.length;
                if (f.label)
                    field.Label = f.label;
                if (f.isPrimaryKey != null)
                    field.IsPrimaryKey = f.isPrimaryKey == true;
                if (f.readOnly != null)
                    field.ReadOnly = f.readOnly == true;
                if (f.onDemand != null)
                    field.OnDemand = f.onDemand == true;
                if (f.default != null)
                    field.HasDefaultValue = true; // do not output the actual value
                if (f.allowNulls != false)
                    field.AllowNulls = true;
                if (f.hidden != null)
                    field.Hidden = f.hidden == true;
                if (f.allowQBE != null)
                    field.AllowQBE = f.allowQBE != false;
                if (f.allowLEV != null)
                    field.AllowLEV = f.allowLEV == true;
                if (f.allowSorting != null)
                    field.AllowSorting = f.allowSorting != false;
                if (f.sourceFields != null)
                    field.SourceFields = f.sourceFields;
                if (f.onDemandStyle)
                    field.OnDemandStyle = OnDemandDisplayStyle.indexOf(f.onDemandStyle);
                if (f.onDemandHandler)
                    field.OnDemandHandler = f.onDemandHandler;
                if (f.contextFields)
                    field.ContextFields = f.ContextFields;
                // skip selectExpression
                // skip computed 
                // skip formula
                if (f.showInSummary != null)
                    field.ShowInSummary = f.showInSummary;
                if (f.htmlEncode != null)
                    field.htmlEncode = f.htmlEncode != false;
                if (f.calculated != null)
                    field.Calculated = f.calculated;
                if (f.causesCalculate != null)
                    field.CausesCalculate = f.causesCalculate == true;
                if (f.isVirtual != null)
                    field.IsVirtual = f.isVirtual == true;
                if (f.configuration)
                    field.Configuration = f.configuration['@value'];
                if (f.dataFormatString)
                    field.DataFormatString = f.dataFormatString;
                if (f.formatOnClient != null)
                    field.FormatOnClient = f.formatOnClient == true;
                // skip editor
                var items = f.items;
                if (items) {
                    if (items.dataController)
                        field.ItemsDataController = items.dataController;
                    if (items.targetController)
                        field.ItemsTargetController = items.targetController;
                }
                var dataView = f.dataView;
                if (dataView) {
                    field.DataViewController = dataView.controller;
                    field.DataViewId = dataView.view;
                    field.DataViewFilterFields = dataView.filterFields
                    field.AllowQBE = true;
                    field.AllowSorting = true;
                    field.Len = 0;
                    field.Columns = 0;
                    field.HtmlEncode = true;
                }
                return field;
            }

            function populatePageFields(page) {
                if (page.Fields.length) return;
                // enumerate data fields in the view
                var dataFields = view.dataFields,
                    categoryMap = {};
                if (view.categories && view.categories.length) {
                    dataFields = [];
                    (view.categories || []).forEach(function (c, categoryIndex) {
                        (c.dataFields || []).forEach(function (df) {
                            dataFields.push(df);
                            categoryMap[df.fieldName] = categoryIndex;
                        });
                    });
                }
                if (!dataFields)
                    dataFields = [];
                // create DataField instances
                dataFields.forEach(function (df) {
                    var f = config._map.fields[df.fieldName],
                        field;
                    if (f) {
                        field = DataField_new(f);
                        if (df.hidden != null)
                            field.Hidden = df.hidden == true;
                        if (df.dataFormatString != null)
                            field.DataFormatString = df.dataFormatString;
                        if (df.formatOnClient != null)
                            field.FormatOnClient = df.formatOnClient != false;
                        if (df.dataFormatString && !field.DataFormatString)
                            field.DataFormatString = dt.dataFormatString;
                        if (df.headerText)
                            field.HeaderText = df.headerText['@value'];
                        if (df.footerText)
                            field.FooterText = df.footerText['@value'];
                        if (df.toolTip)
                            field.toolTip = df.toolTip;
                        if (df.watermark)
                            field.Watermark = df.watermark;
                        if (df.hyperlinkFormatString)
                            field.HyperlinkFormatString = df.hyperlinkFormatString;
                        if (df.aliasFieldName)
                            field.AliasName = df.aliasFieldName;
                        if (df.tag)
                            field.Tag = df.tag;
                        if (df.AllowQBE != null)
                            field.AllowQBE = df.allowQBE == true;
                        if (df.AllowSorting != null)
                            field.AllowSorting = df.allowSorting == true;
                        if (categoryMap[field.Name] != null)
                            field.CategoryIndex = categoryMap[field.Name];
                        if (df.columns != null)
                            field.Columns = df.columns;
                        if (df.rows != null)
                            field.Rows = df.rows;
                        if (df.textMode != null)
                            field.TextMode = TextInputMode.indexOf(df.textMode);
                        // skip Mask
                        // skip MaskType
                        if (df.readOnly != null)
                            field.ReadOnly = df.readOnly;
                        if (df.aggregate)
                            field.Aggregate = DataFieldAggregate.indexOf(df.aggregate);
                        if (df.search)
                            field.Tag = (field.Tag ? field.Tag + ' ' : '') + 'search-mode-' + FieldSearchMode.indexOf(df.search).ToLowerCase();
                        if (df.searchOptions)
                            field.SearchOptions = df.searchOptions;
                        // skip AutoCompletePrefixLength
                        // skip items of the Data Field
                        var items = df.items || f.items;
                        if (items != null) {
                            if (items.dataController)
                                field.ItemsDataController = items.dataController;
                            if (items.dataView)
                                field.ItemsDataView = items.dataView;
                            if (items.dataValueField)
                                field.ItemsDataValueField = items.dataValueField;
                            if (items.dataTextField)
                                field.ItemsDataTextField = items.dataTextField;
                            if (items.style)
                                field.ItemsStyle = items.style;
                            if (items.newDataView)
                                field.ItemsNewDataView = items.newDataView;
                            if (items.targetController)
                                field.ItemsTargetController = items.targetController;
                            if (items.copy)
                                field.Copy = items.copy;
                            if (items.pageSize)
                                field.ItemsPageSize = items.pageSize;
                            if (items.letters != null)
                                field.ItemsLetters = items.letters == true;
                            var list = items.list;
                            if (list && list.length) {
                                field.Items = [];
                                list.forEach(function (item) {
                                    field.Items.push([item.value, item.text]);
                                });
                            }
                            if (items.autoSelect != null)
                                field.AutoSelect = items.autoSelect == true;
                            if (items.searchOnStart != null)
                                field.SearchOnStart = items.searchOnStart == true;
                            if (items.description)
                                field.ItemsDescription = items.description;
                        }
                        page.Fields.push(field);
                        // populate DataView field properties
                        var dataView = f.dataView;
                        if (dataView) {
                            if (dataView.showInSummary != null)
                                field.DataViewShowInSummary = dataView.showInSummary == true;
                            if (dataView.showActionBar != null)
                                field.DataViewShowActionBar = dataView.showActionBar != false;
                            if (dataView.showActionButtons)
                                field.DataViewShowActionButtons = dataView.showActionButtons;
                            if (dataView.showDescription != null)
                                field.DataViewShowDescription = !false;
                            if (dataView.showViewSelector != null)
                                field.DataViewShowViewSelector = dataView.showViewSelector != false;
                            if (dataView.showModalForms != null)
                                field.DataViewShowModalForms = dataView.showModalForms == true;
                            if (dataView.searchByFirstLetter != null)
                                field.DataViewSearchByFirstLetter = dataView.searchByFirstLetter == true;
                            if (dataView.searchOnStart != null)
                                field.SearchOnStart = dataView.searchOnStart == true;
                            if (dataView.pageSize != null)
                                field.DataBViewPageSize = dataView.pageSize;
                            if (dataView.multiSelect)
                                field.DataViewMultiSelect = dataView.multiSelect == true;
                            if (dataView.showPager != null)
                                field.DataViewShowPager = dataVIew.showPager == true;
                            if (dataView.showPageSize != null)
                                field.DataViewShowPageSize = dataView.showPageSize != false;
                            if (dataView.showSearchBar != null)
                                field.DataViewShowSearchBar = dataView.showSearchBar != false;
                            if (dataView.showQuickFind != null)
                                field.DataViewShowQuickFind = dataView.showQuickFind != false;
                            if (dataView.showRowNumber != null)
                                field.DataViewShowRowNumber = dataView.showRowNumber == true;
                            if (dataView.autoSelectFirstRow != null)
                                field.DataViewAutoSelectFirstRow = dataView.autoSelectFirstRow == true;
                            if (dataView.autoHighlightFirstRow != null)
                                field.DataViewAutoHighlightFirstRow = dataView.autoHighlightFirstRow == true;
                        }
                        // popuplate pivot info
                        if (page.RequiresPivot) {
                            // TODO - complete processing of pivot definitions
                        }
                    }
                });
            }

            function ensurePageFields(page) {
                if (config.statusBar)
                    page.statusBar = config.startBar;
                var fields = config.fields,
                    dataFields = page.Fields,
                    dataFieldMap = page._fieldMap = {};
                if (!fields.length)
                    fields.forEach(function (f) {
                        dataFields.push(DataField_new(f));
                    });
                dataFields.forEach(function (df) {
                    dataFieldMap[df.Name] = df;
                });

                function addDataField(f) {
                    if (typeof f == 'string')
                        f = config._map.fields[f];
                    if (f && !dataFieldMap[f.name]) {
                        dataFields.push(DataField_new(f, true));
                        dataFieldMap[f.name] = dataFields[dataFields.length - 1];
                    }
                }

                // ensure primary keys
                fields.forEach(function (f) {
                    if ((f.isPrimaryKey || f.hidden) && !dataFieldMap[f.name])
                        addDataField(f);
                });
                // ensure alias fields
                dataFields.forEach(function (df) {
                    var aliasName = df.AliasName;
                    if (aliasName) {
                        var aliasDataField = dataFieldMap[aliasName];
                        if (aliasDataField)
                            aliasDataField.Hidden = true;
                        else
                            addDataField(aliasName);
                    }
                });
                // ensure groupExpression 
                var groupExpression = view.groupExpression;
                if (groupExpression) {
                    groupExpression.split($app._simpleListRegex).forEach(function (groupField) {
                        addDataField(groupField);
                    });
                }
                // ensure fields specified in "configuration" and "items/copy"
                function parseMappedFields(s, mapIndex) {
                    if (s) {
                        var m = _app._fieldMapRegex.exec(s);
                        while (m) {
                            addDataField(m[mapIndex]);
                            m = _app._fieldMapRegex.exec(s);
                        }
                    }
                }
                dataFields.forEach(function (df) {
                    parseMappedFields(df.Copy, 1);
                    parseMappedFields(df.Configuration, 2);
                });
            }

            function ensureSystemPageFields(request, page) {
                if (page.Distinct) {
                    var i = 0;
                    while (i < page.Fields.length)
                        if (page.Fields[i].IsPrimaryKey)
                            page.Fields.splice(i, 1);
                        else
                            i++;
                    page.Fields.push({ Name: 'group_count_', Type: 'Double' });
                }
            }

            function createValueFromSourceFields(field, obj) {
                var v = '';
                if (obj[field.Name] == null)
                    v = 'null';
                var fieldNames = field.SourceFields.split(_app._simpleListRegex);
                fieldNames.forEach(function (name) {
                    if (v.length)
                        v += '|';
                    var rawValue = obj[name];
                    if (rawValue == null)
                        v += 'null';
                    else
                        v += rawValue.toString();
                });
                return v;
            }

            function ViewPage_addPivotValues(values) {
                // TODO: Implement pivot framework
            }

            function ViewPage_requiresAggregates() {
                for (var i = 0; i < page.Fields.length; i++)
                    if (page.Fields[i].Aggregate)
                        return true;
                return false;
            }

            function populateManyToManyFields(page) {
                var deferred = $.Deferred();
                // TODO: implement
                deferred.resolve();
                return deferred.promise();
            }

            function View_new(v) {
                var view = { Id: v.id, Type: v.type, Label: v.label };
                if (v.headerText)
                    view.HeaderText = v.headerText['@value'];
                if (v.group != null)
                    view.Group = v.group;
                if (v.tags)
                    view.Tags = v.tags;
                if (v.showInSelector == false)
                    view.ShowInSelector = false;
                return view;
            }

            function Action_new(a) {
                var action = { Id: a.id };
                if (a.commandName)
                    action.CommandName = a.commandName;
                if (a.commandArgument != null)
                    action.CommandArgument = a.commandArgument;
                if (a.headerText)
                    action.HeaderText = a.headerText;
                if (a.description)
                    action.Description = a.description;
                if (a.cssClass)
                    action.CssClass = a.cssClass;
                if (a.confirmation)
                    action.Confirmation = a.confirmation;
                if (a.notify)
                    action.Notify = a.notify;
                if (a.whenLastCommandName)
                    action.WhenLastCommandName = a.whenLastCommandName;
                if (a.whenLastCommandArgument)
                    action.WhenLastCommandArgument = a.whenLastCommandArgument;
                if (a.causesValidation != null)
                    action.CausesValidation = a.causesValidation != false;
                if (a.whenKeySelected != null)
                    action.WhenKeySelected = a.whenKeySelected == true;
                if (a.whenTag)
                    action.WhenTag = a.whenTag;
                if (a.whenHRef)
                    action.WhenHRef = a.whenHRef;
                if (a.whenView)
                    action.WhenView = a.whenView;
                if (a.whenClientScript)
                    action.WhenClientScript = a.whenClientScript;
                if (a.key)
                    action.key = a.key;
                return action;
            }

            function ActionGroup_new(ag) {
                var group = { Id: ag.id, Actions: [], Scope: ag.scope };
                if (ag.headerText)
                    group.HeaderText = ag.headerText;
                if (ag.flat == true)
                    group.Flat = true;
                if (ag.actionGroup)
                    ag.actionGroup.forEach(function (a) {
                        group.Actions.push(Action_new(a));
                    });
                return group;
            }

            function ViewPage_applyFieldFilter() {
                var that = this,
                    fields = that.Fields,
                    fieldFilter = that.FieldFilter;
                if (fieldFilter && fieldFilter.length) {
                    var newFields = [];
                    fields.forEach(function (f) {
                        if (f.IsPrimaryKey || ViewPage_includeField.call(that, f.Name))
                            newFields.push(f);
                    });
                    that.Fields = newFields;
                    that.FieldFilter = null;
                }
            }

            function DataField_supportsStaticItems() {
                var that = this,
                    itemsStyle = that.ItemsStyle;
                return that.ItemsDataController && !(itemsStyle == 'AutoComplete' || itemsStyle == 'Lookup');
            }

            function ViewPage_populateStaticItems(field, contextValues) {
                var that = this;
                if (!ViewPage_includeMetadata('items'))
                    return false;
                var supportsStatisItems = DataField_supportsStaticItems.call(field);
                if (supportsStatisItems)
                    ViewPage_initializeManyToManyProperties.call(that, field);
                if (supportsStatisItems) {
                    if (PopulatingStaticItems)
                        return true;
                    PopulatingStaticItems = true;
                    try {
                        var filter,
                            contextFields = field.ContextFields;
                        if (contextFields) {
                            var contextFilter = [],
                                contextIterator = /(\w+)\s*=\s*(.+?)($|,)/,
                                m = contextIterator.match(contextFields),
                                staticContextValues = {};
                            while (m) {
                                var vm = m[2].match(/^(\'(.+?)\'|(\d+))$/);
                                if (vm) {
                                    var lov = staticContextValues[vm[1]];
                                    if (!lov)
                                        lov = staticContextValues[vm[1]] = [];
                                    lov.push(vm[2]);
                                }
                                else if (contextValues) {
                                    contextValues.every(function (cv) {
                                        if (cv.Name == m[2]) {
                                            if (cv.NewValue == null) {
                                                contextValues = null;
                                                return false;
                                            }
                                            contextFilter.push(m[1] + ':=%js%' + JSON.stringify(cv.NewValue));
                                            return false;
                                        }
                                    });
                                    if (!contextValues) return true;
                                }
                                m = contextIterator.match(contextFields);
                            }
                            for (fieldName in staticContextValues) {
                                var lov = staticContextValues[fieldName];
                                for (var i = 0; i < lov.length - 1; i++)
                                    lov[i] = JSON.stringify(lov[i]);
                                if (lov.length == 1)
                                    contextFilter.push(fieldName + ':=' + lov[0]);
                                else
                                    contextFilter.push(fieldName + ':$in$' + lov.join('$or$'));
                            }
                            filter = contextFilter;
                        }
                        var sortExpression = null;
                        if (!field.ItemsTargetController && !field.ItemsDataView)
                            sortExpression = field.ItemsDataTextField;
                        var itemsDataController = field.ItemsDataController,
                            itemsView = field.ItemsDataView,
                            itemsDeferred = $.Deferred();
                        $.when(_odp.getControllers(itemsDataController)).done(function () {
                            $.when(odp.getData(itemsDataController)).done(function () {
                                odp._viewPage({
                                    Controller: itemsDataController, View: itemsView,
                                    PageIndex: 0, PageSize: 1000, SortExpression: sortExpression, Filter: filter, RequiresMetaData: true, MetadataFilter: ['fields']
                                }).done(function (page) {
                                    itemsDeferred.resolve(field, page);
                                });
                            });
                        });
                        return itemsDeferred.promise();
                    }
                    finally {
                        PopulatingStaticItems = false;
                    }
                }
                return false;
            }

            function ViewPage_toFieldIndexMap() {
                var map = {},
                    fields = this.Fields;
                for (i = 0; i < fields.length; i++)
                    map[fields[i].Name] = i;
                return map;

            }

            function ViewPage_populateStaticItems_done(field, itemsPage) {
                if (!field.Items)
                    field.Items = [];
                var that = this,
                    dataValueField = field.ItemsDataValueField,
                    dataTextField = field.ItemsDataTextField,
                    items = field.Items;
                if (!dataValueField)
                    itemsPage.Fields.every(function (df) {
                        if (df.IsPrimaryKey) {
                            dataValueField = df.Name;
                            return false;
                        }
                    });
                if (!dataTextField)
                    itemsPage.Fields.every(function (df) {
                        if (df.Type == 'String') {
                            dataTextField = df.Name;
                            return false;
                        }
                    });
                if (!dataTextField)
                    dataTextField = itemsPage.Fields[0].Name;
                var indexMap = ViewPage_toFieldIndexMap.call(itemsPage);
                var fieldList = [indexMap[dataValueField], indexMap[dataTextField]],
                    copy = field.Copy;
                if (copy) {
                    m = _app._fieldMapRegex.exec(copy);
                    while (m) {
                        var fieldIndex = indexMap[m[2]];
                        if (fieldIndex != null)
                            fieldList.push(fieldIndex);
                        m = _app._fieldMapRegex.exec(copy);
                    }
                }
                itemsPage.Rows.forEach(function (row) {
                    var values = [];
                    fieldList.forEach(function (fieldIndex) {
                        values.push(row[fieldIndex]);
                    });
                    items.push(values);
                });
            }

            function ViewPage_initializeManyToManyProperties(field) {
                var that = this;
                // TODO: complete
            }

            function ViewPage_includeField(fieldName) {
                var fieldFilter = this.FieldFilter;
                return !fieldFilter || fieldFilter.indexOf(fieldName) != -1;
            }

            function ViewPage_toResult(config) {
                var deferred = $.Deferred(),
                    populateStaticItemsDeferred = [],
                    that = this,
                    fields = that.Fields;

                function resolveResult() {
                    deferred.resolve(that);
                }

                if (!that.RequiresMetaData) {
                    fields = [];
                    that.Expressions = null;
                }
                else {
                    if (ViewPage_includeMetadata.call(that, 'views') && config.views)
                        config.views.forEach(function (v) {
                            if (!v.virtualViewId) {
                                var view = View_new(v);
                                that.Views.push(View_new(v));
                                if (view.Id == that.View)
                                    that.ViewHeaderText = view.HeaderText;
                            }
                        });
                    if (ViewPage_includeMetadata.call(that, 'layouts')) {
                        if (view.layout)
                            that.ViewLayout = view.layout['@value'];
                    }
                    if (ViewPage_includeMetadata.call(that, 'actions') && config.actions)
                        config.actions.forEach(function (ag) {
                            that.ActionGroups.push(ActionGroup_new(ag));
                        });
                    if (ViewPage_includeMetadata(that, 'items')) {
                        var contextValues = [],
                            row = that.NewRow;
                        if (!row && that.Rows.length)
                            row = that.Rows[0];
                        if (row != null)
                            fields.forEach(function (field, index) {
                                contextValues.push({ Name: field.Name, Value: row[index] });
                            });
                        fields.forEach(function (field) {
                            if (field.ItemsStyle == 'CheckBoxList' || field.ItemsTargetController || view.type == that._staticLookupViewTypeFilter) {
                                var populateResult = ViewPage_populateStaticItems.call(that, field, contextValues);
                                if (typeof populateResult !== 'boolean')
                                    populateStaticItemsDeferred.push(populateResult);
                            }
                        });
                        var deferredCount = populateStaticItemsDeferred.length;
                        if (deferredCount)
                            $.when.apply($, populateStaticItemsDeferred).done(function () {
                                var list = arguments;
                                if (deferredCount == 1)
                                    list = [list];
                                for (var i = 0; i < list.length; i++)
                                    ViewPage_populateStaticItems_done.call(page, list[i][0], list[i][1]);
                                resolveResult();
                            });
                    }
                }
                if (!ViewPage_includeMetadata.call(that, 'fields'))
                    fields.splice(0, fields.length);
                else {
                    fields.forEach(function (f) {
                        if (f.Formula)
                            delete f.Formula;
                        ViewPage_initializeManyToManyProperties.call(that, f);
                    });
                }
                if (that.Filter)
                    that.Filter.every(function (expression, index) {
                        var isAdvancedSearch = expression.match(/_match_/);
                        if (isAdvancedSearch)
                            that.Filter.splice(index);
                        return !isAdvancedSearch;
                    });
                // additional initialization
                that.IsAuthenticated = !!_app.userName();
                // clearnup
                if (!populateStaticItemsDeferred.length)
                    resolveResult();

                return deferred.promise();
            }

            function ViewPage_fieldIndex(name) {
                var fields = this.Fields;
                for (var i = 0; i < fields.length; i++)
                    if (fields[i].Name == name)
                        return i;
                return -1;
            }

            function ViewPage_NewRow() {
                var deferred = $.Deferred(),
                    page = this,
                    newRow = page.NewRow = [],
                    controller = page.Controller;

                function generateNewRow(obj) {
                    if (obj) {
                        var field, fieldName;
                        for (fieldName in config._map.fields) {
                            field = config._map.fields[fieldName];
                            if (obj && (fieldName in obj))
                                newRow[ViewPage_fieldIndex.call(page, fieldName)] = obj[fieldName];
                        }
                    }
                    deferred.resolve(page);
                }

                // request NewRow from the server when
                // 1. Primary key field is calculated (PK is provided by business rules)
                // 2. There is a business rule with CommandName="New (there are possible default values)

                var hasCalculatedPK;
                for (pkFieldName in config._map.key)
                    if (config._map.fields[pkFieldName].calculated)
                        hasCalculatedPK = true;

                if ((hasCalculatedPK || config.newOnServer) && !isWorkingOffline()) {
                    _app.execute({ controller: controller, view: page.View, requiresNewRow: true, odp: false, nativeDates: false }).done(function (result) {
                        generateNewRow(result[controller][0]);
                    }).fail(generateNewRow);
                }
                else
                    generateNewRow();

                return deferred.promise();
            }

            //****************************************
            // implementation of GetPage method
            //****************************************
            selectView();
            PageRequest_assignContext.call(request, page);
            ViewPage_new.call(page, request);
            ControllerConfiguration_AssignDynamicExpressions.call(config, page);
            if (page.RequiresMetaData && ViewPage_includeMetadata.call(page, 'categories'))
                populatePageCategories(page);
            syncRequestedPage(request, page).done(function (page, sortedAndFilteredObjects) {
                configureCommand(page);
                ViewPage_applyFieldFilter.call(page);
                ensureSystemPageFields(request, page);
                var preFetch = page.SupportsCaching && page.PageSize != Int32_MaxValue,
                    offset = page.PageSize * page.PageIndex + page.PageOffset,
                    limit = page.PageSize,
                    pagesToFetch = 2;
                if (preFetch && offset > page.PageSize)
                    offset -= page.PageSize;
                if (preFetch) {
                    if (offset > page.PageSize)
                        pagesToFetch = 3;
                    limit = page.PageSize * pagesToFetch;
                }
                odp.select({ from: page.Controller, where: toWhere(request, page), sort: toSort(page), yield: sortedAndFilteredObjects }).done(function (objects) {
                    for (var rowIndex = offset; rowIndex < offset + limit && rowIndex < objects.length; rowIndex++) {
                        var obj = objects[rowIndex],
                            values = [], i, field;
                        for (i = 0; i < page.Fields.length; i++) {
                            field = page.Fields[i];
                            values[i] = obj[field.Name];
                            if (field.SourceFields)
                                values[i] = createValueFromSourceFields(field, obj);
                        }
                        if (page.RequiresPivot)
                            ViewPage_addPivotValues.call(page, values);
                        else
                            page.Rows.push(values);
                    }
                    var requiresRowCount = page.RequiresRowCount && !(request.Inserting || request.DoesNotRequireData);
                    if (requiresRowCount)
                        page.TotalRowCount = objects.length;
                    if (!request.DoesNotRequireAggregates && ViewPage_requiresAggregates.call(page)) {
                        var aggregates = page.Aggregates = [],
                            aggregateFields = [];

                        page.Fields.forEach(function (f, index) {
                            if (f.Aggregate)
                                aggregateFields.push({ field: f, index: index, map: {}, sum: 0, count: 0, min: null, max: null });
                        });
                        objects.forEach(function (obj) {
                            aggregateFields.forEach(function (info) {
                                var af = info.field,
                                    v = obj[af.Name], result;
                                switch (af.Aggregate) {
                                    case 1:  // sum
                                        if (v != null)
                                            result = info.sum += v;
                                        break;
                                    case 2:  // count
                                        if (v != null && !info.map[v]) {
                                            result = ++info.count;
                                            info.map[v] = true
                                        }
                                        break;
                                    case 3:  // average
                                        if (v != null) {
                                            info.sum += v;
                                            result = info.sum / (++info.count);
                                        }
                                        break;
                                    case 4:  // max
                                        if (v != null)
                                            if (info.max == null || info.max < v)
                                                result = info.max = v;
                                        break;
                                    case 5:  // min
                                        if (v != null)
                                            if (info.min == null || info.min > v)
                                                result = info.min = v;
                                        break;
                                }
                                if (result != null)
                                    aggregates[info.index] = result;
                            });
                        });
                    }
                    if (request.RequiresFirstLetters && page.ViewType != 'Form')
                        if (!page.RequiresRowCount)
                            page.FirstLetters = '';
                        else {
                            var letterMap = {},
                                letterList = [];
                            letterField = page.Fields[0];
                            objects.forEach(function (obj) {
                                var v = obj[letterField.Name];
                                if (v != null) {
                                    if (typeof v !== 'string')
                                        v = v.toString();
                                    if (v.length) {
                                        var letter = v.substring(0, 1);
                                        if (!letterMap[letter]) {
                                            letterList.push(letter);
                                            letterMap[letter] = true;
                                        }
                                    }
                                }
                            });
                            letterList.sort();
                            page.FirstLetters = letterList.join(',');
                        }

                    function ViewPage_Complete() {
                        if (page.Distinct) {
                            var distinctRows = [],
                                distinctMap = {};
                            page.Rows.forEach(function (r) {
                                var k = r.toString(),
                                    index = distinctMap[k];
                                if (index == null) {
                                    distinctMap[k] = distinctRows.length;
                                    distinctRows.push(r);
                                    r[r.length - 1] = 0;
                                }
                                else
                                    r = distinctRows[index];
                                r[r.length - 1]++;
                            });
                            page.Rows = distinctRows;
                        }
                        ViewPage_toResult.call(page, config).done(function (page) {
                            pageDeferred.resolve(page);
                        });
                    }

                    if (request.Inserting)
                        ViewPage_NewRow.call(page).done(ViewPage_Complete);
                    else
                        populateManyToManyFields(page).done(ViewPage_Complete);
                });
            })
            return pageDeferred.promise();
        }
    };

    function htmlDecode(s) {
        var decoder = _app._htmlDecoder;
        if (!decoder)
            decoder = _app._htmlDecoder = document.createElement("textarea");;
        decoder.innerHTML = s;
        return decoder.value;

    }

    $(document).on('starting.app', function (e) {
        if (e.namespace == 'app')
            _odp.start();
    });

})();