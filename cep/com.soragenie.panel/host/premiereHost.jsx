var weaveEdit = (function () {
  var TICKS_PER_SECOND = 254016000000;

  function getJson() {
    if (typeof JSON !== "undefined" && JSON && JSON.stringify && JSON.parse) {
      return JSON;
    }

    return {
      stringify: function (value) {
        return value.toSource();
      },
      parse: function (value) {
        return eval("(" + value + ")");
      }
    };
  }

  function stringify(value) {
    return getJson().stringify(value);
  }

  function parse(value) {
    return getJson().parse(value);
  }

  function normalizePath(filePath) {
    return String(filePath || "").replace(/\\/g, "/");
  }

  function secondsToTicks(seconds) {
    return String(Math.round(Number(seconds) * TICKS_PER_SECOND));
  }

  function makeTime(seconds) {
    var time = new Time();
    time.seconds = Number(seconds);
    return time;
  }

  function fail(message, details) {
    return stringify({
      ok: false,
      connected: true,
      message: message,
      details: details || [],
      placedCount: 0,
      blankCount: 0,
      importedCount: 0,
      appendOffsetSec: 0,
      skippedCount: 0,
      clippedCount: 0,
      workingRangeStartSec: 0,
      workingRangeEndSec: 0
    });
  }

  function readTextFile(filePath) {
    var file = new File(filePath);
    file.encoding = "UTF8";

    if (!file.exists) {
      throw new Error("Missing job file: " + filePath);
    }

    if (!file.open("r")) {
      throw new Error("Could not open job file: " + filePath);
    }

    var contents = file.read();
    file.close();
    return contents;
  }

  function selectFolderPath() {
    try {
      var folder = Folder.selectDialog("Choose media folder");
      if (!folder) {
        return stringify({
          status: "cancelled",
          path: null
        });
      }

      return stringify({
        status: "selected",
        path: normalizePath(folder.fsName)
      });
    } catch (error) {
      return stringify({
        status: "dialog_error",
        path: null,
        message: error.message || String(error)
      });
    }
  }

  function getTrackEndSec(track) {
    if (!track || !track.clips || track.clips.numItems < 1) {
      return 0;
    }

    return Number(track.clips[track.clips.numItems - 1].end.seconds || 0);
  }

  function getSequenceFrameRate(sequence) {
    try {
      var timebase = Number(sequence && sequence.timebase);
      if (timebase > 0) {
        return Math.round((TICKS_PER_SECOND / timebase) * 100) / 100;
      }
    } catch (error) {
      // Fall back below.
    }

    return 30;
  }

  function getRangeStatus(sequence) {
    var inTime = sequence && sequence.getInPointAsTime ? sequence.getInPointAsTime() : null;
    var outTime = sequence && sequence.getOutPointAsTime ? sequence.getOutPointAsTime() : null;
    var inSec = inTime ? Number(inTime.seconds || 0) : 0;
    var outSec = outTime ? Number(outTime.seconds || 0) : 0;
    var sequenceEndSec = sequence && sequence.end ? Number(sequence.end) / TICKS_PER_SECOND : 0;
    var hasMeaningfulInOut = inSec > 0.0001 || (outSec > 0 && outSec < sequenceEndSec - 0.0001);

    return {
      inSec: inSec,
      outSec: outSec,
      sequenceEndSec: sequenceEndSec,
      hasMeaningfulInOut: hasMeaningfulInOut
    };
  }

  function getStatus() {
    if (!app || !app.project) {
      return stringify({
        ok: false,
        connected: true,
        projectName: "",
        sequenceName: "",
        videoTracks: [],
      frameRate: 30,
        range: {
          inSec: 0,
          outSec: 0,
          sequenceEndSec: 0,
          hasMeaningfulInOut: false
        },
        message: "Premiere project is not available."
      });
    }

    var sequence = app.project.activeSequence;
    if (!sequence) {
      return stringify({
        ok: false,
        connected: true,
        projectName: app.project.name || "",
        sequenceName: "",
        videoTracks: [],
        frameRate: 30,
        range: {
          inSec: 0,
          outSec: 0,
          sequenceEndSec: 0,
          hasMeaningfulInOut: false
        },
        message: "Open or activate a sequence first."
      });
    }

    var range = getRangeStatus(sequence);
    var videoTracks = [];
    for (var index = 0; index < sequence.videoTracks.numTracks; index += 1) {
      videoTracks.push({
        index: index,
        name: sequence.videoTracks[index].name || ("V" + (index + 1)),
        endSec: getTrackEndSec(sequence.videoTracks[index])
      });
    }

    return stringify({
      ok: true,
      connected: true,
      projectName: app.project.name || "",
      sequenceName: sequence.name || "",
      videoTracks: videoTracks,
      range: range,
      frameRate: getSequenceFrameRate(sequence)
    });
  }

  function getTranscriptSegments() {
    if (!app || !app.project || !app.project.activeSequence) {
      return stringify([]);
    }

    var sequence = app.project.activeSequence;
    var markers = sequence.markers;
    var segments = [];

    if (!markers || !markers.getFirstMarker) {
      return stringify(segments);
    }

    var marker = markers.getFirstMarker();
    var index = 0;

    while (marker) {
      var text = String(marker.comments || marker.name || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
      if (text) {
        var startSec = marker.start ? Number(marker.start.seconds || 0) : 0;
        var endSec = null;

        try {
          if (marker.end) {
            endSec = Number(marker.end.seconds || 0);
            if (!isFinite(endSec) || endSec <= startSec) {
              endSec = null;
            }
          }
        } catch (error) {
          endSec = null;
        }

        segments.push({
          id: "marker-" + (index + 1),
          startSec: startSec,
          endSec: endSec,
          text: text
        });
        index += 1;
      }

      marker = markers.getNextMarker(marker);
    }

    return stringify(segments);
  }

  function findProjectItemByPath(projectItem, normalizedTargetPath) {
    if (!projectItem) {
      return null;
    }

    try {
      if (projectItem.getMediaPath) {
        var mediaPath = projectItem.getMediaPath();
        if (mediaPath && normalizePath(mediaPath) === normalizedTargetPath) {
          return projectItem;
        }
      }
    } catch (error) {
      // Skip synthetic items that do not expose a real media path.
    }

    if (projectItem.children && projectItem.children.numItems) {
      for (var index = 0; index < projectItem.children.numItems; index += 1) {
        var childResult = findProjectItemByPath(projectItem.children[index], normalizedTargetPath);
        if (childResult) {
          return childResult;
        }
      }
    }

    return null;
  }

  function getOrImportProjectItems(mediaPaths, details) {
    var root = app.project.rootItem;
    var insertionBin = app.project.getInsertionBin ? app.project.getInsertionBin() : root;
    var itemsByPath = {};
    var missingPaths = [];
    var importedCount = 0;

    for (var index = 0; index < mediaPaths.length; index += 1) {
      var normalizedPath = normalizePath(mediaPaths[index]);
      var existingItem = findProjectItemByPath(root, normalizedPath);

      if (existingItem) {
        itemsByPath[normalizedPath] = existingItem;
      } else {
        missingPaths.push(normalizedPath);
      }
    }

    if (missingPaths.length > 0) {
      var importResult = app.project.importFiles(missingPaths, true, insertionBin || root, false);
      if (!importResult) {
        details.push("Premiere reported a media import failure.");
      }

      importedCount = missingPaths.length;
    }

    for (var verifyIndex = 0; verifyIndex < mediaPaths.length; verifyIndex += 1) {
      var verifyPath = normalizePath(mediaPaths[verifyIndex]);
      if (!itemsByPath[verifyPath]) {
        var importedItem = findProjectItemByPath(root, verifyPath);
        if (importedItem) {
          itemsByPath[verifyPath] = importedItem;
        } else {
          details.push("Could not find imported item for " + verifyPath);
        }
      }
    }

    return {
      itemsByPath: itemsByPath,
      importedCount: importedCount
    };
  }

  function findPlacedTrackItem(track, projectItem, expectedStartSec) {
    for (var index = track.clips.numItems - 1; index >= 0; index -= 1) {
      var clip = track.clips[index];
      var startDiff = Math.abs(Number(clip.start.seconds) - expectedStartSec);

      if (clip.projectItem && clip.projectItem.nodeId === projectItem.nodeId && startDiff < 0.5) {
        return clip;
      }
    }

    return null;
  }

  function hasTrackCollision(track, startSec, endSec) {
    if (!track || !track.clips) {
      return false;
    }

    for (var index = 0; index < track.clips.numItems; index += 1) {
      var clip = track.clips[index];
      var clipStart = Number(clip.start.seconds || 0);
      var clipEnd = Number(clip.end.seconds || 0);
      if (clipEnd > startSec && clipStart < endSec) {
        return true;
      }
    }

    return false;
  }

  function runJobFromFile(filePath) {
    try {
      var rawJob = readTextFile(filePath);
      var job = parse(rawJob);
      return runJob(job);
    } catch (error) {
      return fail(error.message || String(error));
    }
  }

  function runJob(job) {
    if (!app || !app.project) {
      return fail("Premiere project is not available.");
    }

    var sequence = app.project.activeSequence;
    if (!sequence) {
      return fail("Open or activate a sequence first.");
    }

    var targetTrackIndex = Number(job.targetVideoTrackIndex || 0);
    if (targetTrackIndex < 0 || targetTrackIndex >= sequence.videoTracks.numTracks) {
      return fail("Target video track does not exist. Add the track in Premiere first.");
    }

    var targetTrack = sequence.videoTracks[targetTrackIndex];
    var details = [];
    var mediaPaths = [];
    var placementIndex;

    for (placementIndex = 0; placementIndex < job.placements.length; placementIndex += 1) {
      var placement = job.placements[placementIndex];
      if (placement.mediaPath) {
        mediaPaths.push(normalizePath(placement.mediaPath));
      }
    }

    var importState = getOrImportProjectItems(mediaPaths, details);
    var itemsByPath = importState.itemsByPath;
    var range = getRangeStatus(sequence);
    var appendOffsetSec = job.appendAtTrackEnd ? getTrackEndSec(targetTrack) : 0;
    var useSequenceInOut = Boolean(job.useSequenceInOut);
    var workingRangeStartSec = useSequenceInOut && range.hasMeaningfulInOut
      ? Number(job.rangeStartSec || range.inSec || 0)
      : 0;
    var workingRangeEndSec = useSequenceInOut && range.hasMeaningfulInOut
      ? Number(job.rangeEndSec || range.outSec || range.sequenceEndSec || 0)
      : range.sequenceEndSec;
    var placedCount = 0;
    var blankCount = 0;
    var skippedCount = 0;
    var clippedCount = 0;

    for (placementIndex = 0; placementIndex < job.placements.length; placementIndex += 1) {
      var currentPlacement = job.placements[placementIndex];
      var trackOffset = Number(currentPlacement.trackOffset || 0);
      var resolvedTrackIndex = targetTrackIndex + trackOffset;
      if (resolvedTrackIndex < 0 || resolvedTrackIndex >= sequence.videoTracks.numTracks) {
        details.push("Skipped " + currentPlacement.id + " because V" + (resolvedTrackIndex + 1) + " does not exist.");
        continue;
      }

      var resolvedTrack = sequence.videoTracks[resolvedTrackIndex];
      var durationSec = Math.max(0.3, Number(currentPlacement.durationSec || 0));
      var requestedStartSec = appendOffsetSec + Number(currentPlacement.startSec || 0);
      var requestedEndSec = appendOffsetSec + Number(currentPlacement.endSec || (currentPlacement.startSec + durationSec));
      var startSec = requestedStartSec;
      var endSec = requestedEndSec;

      if (useSequenceInOut && range.hasMeaningfulInOut) {
        if (requestedEndSec <= workingRangeStartSec || requestedStartSec >= workingRangeEndSec) {
          skippedCount += 1;
          details.push("Skipped " + currentPlacement.id + " because it falls outside the active In/Out range.");
          continue;
        }

        startSec = Math.max(requestedStartSec, workingRangeStartSec);
        endSec = Math.min(requestedEndSec, workingRangeEndSec);
        durationSec = Math.max(0.3, endSec - startSec);

        if (startSec !== requestedStartSec || endSec !== requestedEndSec) {
          clippedCount += 1;
        }
      }

      if (trackOffset > 0 && hasTrackCollision(resolvedTrack, startSec, endSec)) {
        details.push("Skipped " + currentPlacement.id + " because overlap track V" + (resolvedTrackIndex + 1) + " already has media in that range.");
        continue;
      }

      if (!currentPlacement.mediaPath || currentPlacement.strategy === "blank") {
        blankCount += 1;
        continue;
      }

      var projectItem = itemsByPath[normalizePath(currentPlacement.mediaPath)];
      if (!projectItem) {
        blankCount += 1;
        details.push("Missing media for placement " + currentPlacement.id);
        continue;
      }

      try {
        if (projectItem.setInPoint) {
          projectItem.setInPoint(0, 4);
        }

        if (projectItem.setOutPoint) {
          projectItem.setOutPoint(durationSec, 4);
        }

        resolvedTrack.overwriteClip(projectItem, secondsToTicks(startSec));

        var trackItem = findPlacedTrackItem(resolvedTrack, projectItem, startSec);
        if (trackItem) {
          trackItem.end = makeTime(startSec + durationSec);
        }

        placedCount += 1;
      } catch (error) {
        blankCount += 1;
        details.push("Failed to place " + projectItem.name + ": " + (error.message || String(error)));
      }
    }

    return stringify({
      ok: true,
      message: "Placed " + placedCount + " media clips on V" + (targetTrackIndex + 1) + ".",
      placedCount: placedCount,
      blankCount: blankCount,
      importedCount: importState.importedCount,
      appendOffsetSec: appendOffsetSec,
      skippedCount: skippedCount,
      clippedCount: clippedCount,
      workingRangeStartSec: workingRangeStartSec,
      workingRangeEndSec: workingRangeEndSec,
      details: details
    });
  }

  return {
    getStatus: getStatus,
    getTranscriptSegments: getTranscriptSegments,
    pickFolder: selectFolderPath,
    runJob: function (rawJob) {
      try {
        return runJob(parse(rawJob));
      } catch (error) {
        return fail(error.message || String(error));
      }
    },
    runJobFromFile: runJobFromFile
  };
}());
