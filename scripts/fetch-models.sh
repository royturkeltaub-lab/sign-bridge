#!/bin/sh
# Downloads the models the app needs into public/models (run once; ~12 MB, plus ~19 MB for
# word-level sign reading: the MediaPipe holistic landmarker and the 250-sign ASL model).
set -e
cd "$(dirname "$0")/../public/models"
BASE=https://storage.googleapis.com/mediapipe-models
[ -f hand_landmarker.task ] || curl -fL -o hand_landmarker.task "$BASE/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
[ -f face_landmarker.task ] || curl -fL -o face_landmarker.task "$BASE/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
# Word-level signs (src/vision/wordsigns): holistic landmarker + GestureSign model (MIT).
[ -f holistic_landmarker.task ] || curl -fL -o holistic_landmarker.task "$BASE/holistic_landmarker/holistic_landmarker/float16/latest/holistic_landmarker.task"
WORDSIGNS=https://raw.githubusercontent.com/shashank11yadav/GestureSign/main/web/public/models
mkdir -p wordsigns
for f in model.onnx labels.json model-meta.json; do
  [ -f "wordsigns/$f" ] || curl -fL -o "wordsigns/$f" "$WORDSIGNS/$f"
done
ls -la . wordsigns
