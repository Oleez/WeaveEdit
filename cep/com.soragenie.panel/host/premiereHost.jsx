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

  function getTrackEndSec(track) {
    if (!track || !track.clips || track.clips.numItems < 1) {
      return 0;
    }

    return Number(track.clips[track.clips.numItems - 1].end.seconds || 0);
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
      range: range
    });
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

  function getOrImportProjectItems(imagePaths, details) {
    var root = app.project.rootItem;
    var insertionBin = app.project.getInsertionBin ? app.project.getInsertionBin() : root;
    var itemsByPath = {};
    var missingPaths = [];
    var importedCount = 0;

    for (var index = 0; index < imagePaths.length; index += 1) {
      var normalizedPath = normalizePath(imagePaths[index]);
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

    for (var verifyIndex = 0; verifyIndex < imagePaths.length; verifyIndex += 1) {
      var verifyPath = normalizePath(imagePaths[verifyIndex]);
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
    var imagePaths = [];
    var placementIndex;

    for (placementIndex = 0; placementIndex < job.placements.length; placementIndex += 1) {
      var placement = job.placements[placementIndex];
      if (placement.imagePath) {
        imagePaths.push(normalizePath(placement.imagePath));
      }
    }

    var importState = getOrImportProjectItems(imagePaths, details);
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

      if (!currentPlacement.imagePath || currentPlacement.strategy === "blank") {
        blankCount += 1;
        continue;
      }

      var projectItem = itemsByPath[normalizePath(currentPlacement.imagePath)];
      if (!projectItem) {
        blankCount += 1;
        details.push("Missing image for placement " + currentPlacement.id);
        continue;
      }

      try {
        if (projectItem.setInPoint) {
          projectItem.setInPoint(0, 4);
        }

        if (projectItem.setOutPoint) {
          projectItem.setOutPoint(durationSec, 4);
        }

        targetTrack.overwriteClip(projectItem, secondsToTicks(startSec));

        var trackItem = findPlacedTrackItem(targetTrack, projectItem, startSec);
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
      message: "Placed " + placedCount + " stills on V" + (targetTrackIndex + 1) + ".",
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
