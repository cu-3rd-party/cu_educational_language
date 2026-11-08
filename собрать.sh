#!/bin/sh

set -xe

mkdir -p ./сборка/
rustc -o ./сборка/цуяк -g исходники/цуяк.rs
