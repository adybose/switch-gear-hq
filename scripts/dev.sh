#!/bin/sh
# Runs the store (http://localhost:3000) and sim (http://localhost:4000) in watch mode.
# Ctrl-C stops both.
trap 'kill 0' INT TERM EXIT
npm run dev -w @switch-gear/store &
npm run dev -w @switch-gear/sim &
wait
