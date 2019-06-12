'use strict';

export function sleep (n) {
  return new Promise((resolve) => setTimeout(resolve, n));
}

export function jittery (min, max) {
  return Math.round(Math.random() * (max - min) + min);
}
