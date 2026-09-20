// Column-major 4x4 helpers — the subset of reference/renderer/src/math.js the viewer needs.

export function mat4() { return new Float32Array(16); }

export function identity(out) {
  out.fill(0); out[0] = out[5] = out[10] = out[15] = 1;
  return out;
}

export function multiply(out, a, b) {
  const a00=a[0], a01=a[1], a02=a[2], a03=a[3];
  const a10=a[4], a11=a[5], a12=a[6], a13=a[7];
  const a20=a[8], a21=a[9], a22=a[10], a23=a[11];
  const a30=a[12],a31=a[13],a32=a[14], a33=a[15];
  for (let c = 0; c < 4; c++) {
    const b0=b[c*4], b1=b[c*4+1], b2=b[c*4+2], b3=b[c*4+3];
    out[c*4]   = b0*a00+b1*a10+b2*a20+b3*a30;
    out[c*4+1] = b0*a01+b1*a11+b2*a21+b3*a31;
    out[c*4+2] = b0*a02+b1*a12+b2*a22+b3*a32;
    out[c*4+3] = b0*a03+b1*a13+b2*a23+b3*a33;
  }
  return out;
}

export function perspective(out, fovy, aspect, near, far) {
  const f = 1.0 / Math.tan(fovy * 0.5);
  const nf = 1.0 / (near - far);
  out.fill(0);
  out[0]=f/aspect; out[5]=f; out[10]=(far+near)*nf; out[11]=-1; out[14]=2*far*near*nf;
  return out;
}

export function ortho(out, l, r, b, t, n, f) {
  const lr = 1 / (l - r), bt = 1 / (b - t), nf = 1 / (n - f);
  out.fill(0);
  out[0]=-2*lr; out[5]=-2*bt; out[10]=2*nf;
  out[12]=(l+r)*lr; out[13]=(t+b)*bt; out[14]=(f+n)*nf; out[15]=1;
  return out;
}

// view = T(0,0,-dist) · Rx(pitch) · Ry(-yaw) · T(-target), orbiting `target`.
// pitch = π/2 looks straight down −Y with −Z up the screen (the flat pose).
export function orbitView(out, yaw, pitch, dist, t = [0, 0, 0]) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  out[0]=cy;   out[1]=sp*sy;  out[2]=-cp*sy; out[3]=0;
  out[4]=0;    out[5]=cp;     out[6]=sp;     out[7]=0;
  out[8]=sy;   out[9]=-sp*cy; out[10]=cp*cy; out[11]=0;
  out[12] = -(cy * t[0] + sy * t[2]);
  out[13] = -(sp * sy * t[0] + cp * t[1] - sp * cy * t[2]);
  out[14] = -(-cp * sy * t[0] + sp * t[1] + cp * cy * t[2]) - dist;
  out[15] = 1;
  return out;
}

// Camera world position for orbitView: target + Rᵀ · (0,0,dist).
export function orbitEye(yaw, pitch, dist, t = [0, 0, 0]) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  return [t[0] - cp * sy * dist, t[1] + sp * dist, t[2] + cp * cy * dist];
}
