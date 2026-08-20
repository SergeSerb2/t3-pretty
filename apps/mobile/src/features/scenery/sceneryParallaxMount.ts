/** Gyro parallax mounts only when 3D is on and Reduce Motion is off. */
export function shouldMountSceneryParallax(depthEffects: boolean, reduceMotion: boolean): boolean {
  return depthEffects && !reduceMotion;
}
