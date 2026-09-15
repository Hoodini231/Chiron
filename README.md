# Dodgeball Motion Lab

A local camera app with a full-height 75% video / 25% sidebar layout. The sidebar is split equally between stats/ball colour and advice. A separate Results page loads saved recordings.

## Run

Run `npm start` (Python 3.9+ and Node for npm scripts; no package installation needed), then open http://127.0.0.1:8765. Chrome or Edge is recommended. Enable the camera, choose the ball colour, wait for all three pipelines, then Start / Stop.

Stopping saves an original browser-camera recording, an annotated recording and combined data automatically:

```
results/<recording-id>/
  original.webm       # or .mp4, depending on browser support
  processed.webm
  data.json
  manifest.json
  advice.json         # after a successful LLM request
```

The Results page provides playback, duration, actual processing rate, detection coverage, projected elbow-angle ranges, ball path and LLM advice. Video seeking uses HTTP range requests. Unfinished writes stay in `.capture-temp/` and do not appear in Results. Save errors offer Retry and local downloads. Each clip is limited to two minutes; hiding the page stops recording. No audio is captured.

## Three pipelines

Every processed frame is frozen once and shares one timestamp across:

1. **Ball:** OpenCV HSV thresholding, morphology, contours, shape/size filters and temporal association. Red wraps around the hue boundary. Presets: red, teal, yellow, purple; click-to-sample and tolerance/saturation controls are available.
2. **Body:** MediaPipe Pose Landmarker Lite, 33 landmarks, visibility/presence and projected elbow/knee angles. Lines are blue.
3. **Hands:** MediaPipe Hand Landmarker, up to two hands with 21 landmarks each. Lines are orange. The full captured frame feeds hand detection to preserve crop detail. Outputs include model-reported handedness, gated one-to-one association with visible body wrists, projected finger PIP angles and a signed forearm-to-middle-MCP direction proxy for wrist bend.

Ball/body processing uses an image up to 640 pixels wide. All coordinates are exported in explicit coordinate systems. Handedness score is classification confidence, not landmark accuracy. Model-relative z is not calibrated depth. Tiny hands suppress angle features. Side association may be unavailable or wrong during occlusion/crossing; no persistent hand identity is claimed.

## Advice philosophy and setup

The LLM receives numeric summary stats and up to 96 timestamped samples of pose, hand and ball data. It does **not** receive videos or photos. It must return Observations, Try next and Limits, with timestamp evidence for mechanics claims. Sparse evidence should produce capture improvements. Suggested technique changes are experiments, not proven causal corrections.

To connect advice, copy `.env.example` to `.env`, set `OPENAI_API_KEY` privately, and restart the server. Optional `OPENAI_MODEL` defaults to `gpt-5-mini`. The key stays server-side. Clicking Get coaching advice on a result sends derived data to OpenAI's Responses API with `store: false`; the returned text is saved in that result's `advice.json`. Without a configured key, the UI states that the LLM is not connected. Never commit `.env` or recordings.

## Current measurement limits

This is a capture/integration prototype, not validated throwing analysis. Speed in m/s, load/release events, spin and true 3D ball curvature are explicitly unavailable. Finger and wrist signals can support later flick analysis, but do not establish spin or causation. Projected angles depend on camera view. Whole-clip angle ranges are not throwing-phase-specific ranges.

CPU inference currently runs on the main browser thread. Processing cadence may be substantially below camera acquisition rate (the three-model test ran around 10–11 FPS on this host). Raw video is saved separately for later offline/high-frame-rate reprocessing. Do not use this live cadence to judge a fast wrist flick or exact release timing. The recorded stream and JSON begin with a small uncalibrated recorder startup offset. Motion blur, occlusion and matching-colour backgrounds can cause misses or identity switches.

Future: workers/offline frame processing, manually validated phase detection, hand/ball separation events, calibration, synchronized views, phase-specific evidence and within-athlete comparisons.

## Checks

- `npm test`: hue wrapping, actual OpenCV synthetic detections for all four colours, missing observations, projected angles, hand association and tiny-hand suppression.
- `python3 -B -m unittest discover -s tests -p 'test_*.py'`: isolated save transaction, incomplete recording exclusion, playback range requests, origin/path restrictions and missing LLM key.
- `python3 server.py --port 8766 --test-mode`: isolated browser QA. Open `/__test__/capture` for an animated synthetic ball, `?pose=1` for a body fixture or `?pose=hands` for a hand fixture. Test recordings go to a temporary directory, not your results folder. These routes are disabled in normal mode.

## Pinned dependencies and fixture sources

OpenCV: `@techstark/opencv-js@4.12.0-release.1` from jsDelivr. MediaPipe Tasks Vision: `0.10.21` from jsDelivr. Pose Lite and Hand Landmarker model bundles: version 1 float16 from Google's mediapipe-models bucket. Licenses are under `dist/vendor/`.

Body fixture: https://storage.googleapis.com/mediapipe-assets/pose.jpg
Hand fixture: https://storage.googleapis.com/mediapipe-tasks/hand_landmarker/woman_hands.jpg, used in the official MediaPipe samples; original: https://unsplash.com/photos/mt2fyrdXxzk.

This version uses a local Python server and filesystem storage. It is not a static hosted deployment.
