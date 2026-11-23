#!/bin/sh
# Downloads the MediaPipe models the app needs into public/models (run once; ~12 MB).
set -e
cd "$(dirname "$0")/../public/models"
BASE=https://storage.googleapis.com/mediapipe-models
[ -f hand_landmarker.task ] || curl -fL -o hand_landmarker.task "$BASE/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
[ -f face_landmarker.task ] || curl -fL -o face_landmarker.task "$BASE/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
ls -la
