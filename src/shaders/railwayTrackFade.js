import * as THREE from 'three'

const MARK = '__railTrackFadeInstalled'

export function installRailwayTrackFade(material, uniforms) {
  if (material[MARK]) return
  material[MARK] = true

  material.transparent = true
  material.depthWrite = false

  const prev = material.onBeforeCompile
  material.onBeforeCompile = (shader) => {
    prev?.(shader)

    Object.assign(shader.uniforms, uniforms)

    if (!shader.vertexShader.includes('varying float vTrackFade')) {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `
#include <common>
varying float vTrackFade;
uniform float uFadeWidth;
uniform float uArcBase;
uniform float uArcDelta;
uniform vec3 uOrigin;
uniform vec3 uTangent;
uniform float uSegLen;
`,
      )

      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
#include <begin_vertex>
vec4 _wp = modelMatrix * vec4( transformed, 1.0 );
float _t = clamp( dot( _wp.xyz - uOrigin, uTangent ) / max( uSegLen, 1e-4 ), 0.0, 1.0 );
float _arcU = clamp( uArcBase + _t * uArcDelta, 0.0, 1.0 );
float _fw = max( uFadeWidth, 1e-4 );
vTrackFade = smoothstep( 0.0, _fw, _arcU ) * ( 1.0 - smoothstep( 1.0 - _fw, 1.0, _arcU ) );
`,
      )
    }

    if (!shader.fragmentShader.includes('varying float vTrackFade')) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `
#include <common>
varying float vTrackFade;
`,
      )

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `
#include <color_fragment>
diffuseColor.a *= vTrackFade;
`,
      )
    }
  }

  material.needsUpdate = true
}

/**
 * @param {THREE.Object3D} root
 * @param {(mat: THREE.Material) => void} fn
 */
export function forEachMeshMaterial(root, fn) {
  root.traverse((o) => {
    if (!o.isMesh) return
    const mats = Array.isArray(o.material) ? o.material : [o.material]
    for (const m of mats) fn(m)
  })
}
