#version 120

//------------------------------------------------------------------------------------
// A lot of the functions adapted from iq.
// http://www.iquilezles.org/
// https://www.shadertoy.com/user/iq




#define MAX_CUBES 100

uniform vec2 resolution; // screen resolution
uniform float time; // current time
uniform vec2 mouse; // mouse position (screen space)

// uniform vec3 box_pos, box_rot, box_scale;  // for testing individual transforms
// uniform mat4 box_mat;    // for testing whole transform
uniform mat4 box_mats[MAX_CUBES];

uniform float thresh;

uniform int num_cubes;

uniform mat4 invViewMatrix;
uniform float tanHalfFov; // tan(fov/2)

uniform float blend_k;

const float EPSILON = 0.01;
const float PI = 3.1415926535;
const float PI2 = PI*2.0;

float radians( float x )
{
    return PI/180.*x;
}

uniform vec3 light;

// Modify these functions
float compute_scene( in vec3 p, out int mtl );
vec4 compute_color( in vec3 p, in float distance, in int mtl, in float normItCount );


//------------------------------------------------------------------------------------
#pragma mark NOISE
// SIMPLE NOISE
// Created by inigo quilez - iq/2013
// License Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported License.

// Simplex Noise (http://en.wikipedia.org/wiki/Simplex_noise), a type of gradient noise
// that uses N+1 vertices for random gradient interpolation instead of 2^N as in regular
// latice based Gradient Noise.

vec2 hash( vec2 p )
{
    p = vec2( dot(p,vec2(127.1,311.7)),
             dot(p,vec2(269.5,183.3)) );
    
    return -1.0 + 2.0*fract(sin(p)*43758.5453123);
}

float noise( in vec2 p )
{
    const float K1 = 0.366025404; // (sqrt(3)-1)/2;
    const float K2 = 0.211324865; // (3-sqrt(3))/6;
    
    vec2 i = floor( p + (p.x+p.y)*K1 );
    
    vec2 a = p - i + (i.x+i.y)*K2;
    vec2 o = (a.x>a.y) ? vec2(1.0,0.0) : vec2(0.0,1.0); //vec2 of = 0.5 + 0.5*vec2(sign(a.x-a.y), sign(a.y-a.x));
    vec2 b = a - o + K2;
    vec2 c = a - 1.0 + 2.0*K2;
    
    vec3 h = max( 0.5-vec3(dot(a,a), dot(b,b), dot(c,c) ), 0.0 );
    
    vec3 n = h*h*h*h*vec3( dot(a,hash(i+0.0)), dot(b,hash(i+o)), dot(c,hash(i+1.0)));
    
    return dot( n, vec3(70.0) );
}



//------------------------------------------------------------------------------------
#pragma mark UTILS
float saturate( in float v )
{
    return clamp(v,0.0,1.0);
}

float expose( in float l, in float e )
{
    return (1.5 - exp(-l*e));
}

const vec4 lumi = vec4(0.30, 0.59, 0.11, 0);

float luminosity( in vec4 clr )
{
    return dot(clr, lumi);
}

vec4  normal_color( in vec3 n )
{
    return vec4((n*vec3(0.5)+vec3(0.5)), 1);
}

float attenuation( in float distance, in float atten )
{
    return min( 1.0/(atten*distance*distance), 1.0 );
}

//// Smooth blend functions
////  http://www.iquilezles.org/www/articles/smin/smin.htm
float smin_exp( float a, float b, float k )
{
    float res = exp( -k*a ) + exp( -k*b );
    return -log( res )/k;
}

float smin_poly( float a, float b, float k )
{
    float h = clamp( 0.5+0.5*(b-a)/k, 0.0, 1.0 );
    return mix( b, a, h ) - k*h*(1.0-h);
}


// power smooth min (k = 8);
float smin_power( float a, float b, float k )
{
    a = pow( a, k ); b = pow( b, k );
    return pow( (a*b)/(a+b), 1.0/k );
}


//------------------------------------------------------------------------------------
#pragma mark SDF PRIMITIVES
// SDF Objects
// p: sample position
// assumes object is at 0, 0, 0

//f(x,z) = sin(x)·sin(z)
//color = pow( color, vec3(1.0/2.2) );
float sdf_xz_plane(in vec3 p, float y)
{
    return p.y - y;//+ sin(p.x*1.0)*sin(p.z*1.0)*0.9 - y; // + sin(p.x*3.0)*sin(p.z*2.0)*0.3
}

float sdf_xy_plane(in vec3 p, float z)
{
    return p.z - z;//+ sin(p.x*1.0)*sin(p.z*1.0)*0.9 - y; // + sin(p.x*3.0)*sin(p.z*2.0)*0.3
}

float sdf_yz_plane(in vec3 p, float x)
{
    return p.x - x;//+ sin(p.x*1.0)*sin(p.z*1.0)*0.9 - y; // + sin(p.x*3.0)*sin(p.z*2.0)*0.3
}

float sdf_box(in vec3 p, in vec3 size)
{
    vec3 d = abs(p) - size;
    return min(max(d.x,max(d.y,d.z)),0.0) + length(max(d,0.0));
}

float sdf_round_box(in vec3 p, in vec3 size, float smoothness )
{
    return length(max(abs(p)-size*0.5,0.0))-smoothness;
}

float sdf_sphere(in vec3 p, in float radius)
{
    return length(p)-radius;
}

float sdf_torus(in vec3 p, in float radius, in float thickness )
{
    vec2 q = vec2(length(p.xz)-radius,p.y);
    return length(q)-thickness;
}

float sdf_prism( in vec3 p, in vec2 h )
{
    vec3 q = abs(p);
    return max(q.z-h.y,max(q.x*0.866025+p.y*0.5,-p.y)-h.x*0.5);
}


float sdf_torus( in vec3 p, in vec2 t )
{
    return length( vec2(length(p.xz)-t.x,p.y) )-t.y;
}

float sdf_hex_prism( in vec3 p, in vec2 h )
{
    vec3 q = abs(p);
#if 1
    return max(q.z-h.y,max((q.x*0.866025+q.y*0.5),q.y)-h.x);
#else
    float d1 = q.z-h.y;
    float d2 = max((q.x*0.866025+q.y*0.5),q.y)-h.x;
    return length(max(vec2(d1,d2),0.0)) + min(max(d1,d2), 0.);
#endif
}

float sdf_capsule( in vec3 p, in vec3 a, in vec3 b, in float r )
{
    vec3 pa = p-a, ba = b-a;
    float h = clamp( dot(pa,ba)/dot(ba,ba), 0.0, 1.0 );
    return length( pa - ba*h ) - r;
}

float sdf_cylinder( in vec3 p, in vec2 h )
{
    vec2 d = abs(vec2(length(p.xz),p.y)) - h;
    return min(max(d.x,d.y),0.0) + length(max(d,0.0));
}

float sdf_cone( in vec3 p, in vec3 c )
{
    vec2 q = vec2( length(p.xz), p.y );
#if 0
    return max( max( dot(q,c.xy), p.y), -p.y-c.z );
#else
    float d1 = -p.y-c.z;
    float d2 = max( dot(q,c.xy), p.y);
    return length(max(vec2(d1,d2),0.0)) + min(max(d1,d2), 0.);
#endif    
}


//------------------------------------------------------------------------------------
#pragma mark SDF OPERATORS

float sdf_union(in float d1, in float d2)
{
    return min(d1, d2);
}

float sdf_subtract(in float d1, in float d2)
{
    return max(-d2, d1);
}

float sdf_intersect(in float d1, in float d2)
{
    return max(d1, d2);
}

float sdf_blend_exp( in float d1, in float d2, in float k )
{
    return smin_exp(d1, d2, k);
}

float sdf_blend_poly( in float d1, in float d2, in float k )
{
    return smin_poly(d1, d2, k);
}

float sdf_blend_power( in float d1, in float d2, in float k )
{
    return smin_power(d1, d2, k);
}

/*
 float sdf_blend(vec3 p, float a, float b)
 {
 float s = smoothstep(length(p), 0.0, 1.0);
 float d = mix(a, b, s);
 return d;
 }
 */

vec3 sdf_repeat( in vec3 p, in vec3 rep)
{
    vec3 d = mod(p, rep) - 0.5*rep;
    return d;
}

vec3 sdf_translate( in vec3 p, in vec3 offset )
{
    return p-offset;
}


vec3 sdf_rotate_y(in vec3 p, float theta)
{
    float c = cos(theta);
    float s = sin(theta);
    vec3 res;
    res.x = p.x * c - p.z * s;
    res.y = p.y;
    res.z = p.x * s + p.z * c;
    return res;
}

vec3 sdf_rotate_x(in vec3 p, float theta)
{
    float c = cos(theta);
    float s = sin(theta);
    vec3 res;
    res.x = p.x;
    res.y = p.y * c - p.z * s;
    res.z = p.y * s + p.z * c;
    return res;
}

vec3 sdf_rotate_z(in vec3 p, float theta)
{
    float c = cos(theta);
    float s = sin(theta);
    vec3 res;
    res.x = p.x * c - p.y * s;
    res.y = p.x * s + p.y * c;
    res.z = p.z;
    return res;
}

/// We actually pass in the inverse transformation here because it would be slow to do it in the shader.
vec3 sdf_transform(in vec3 p, in mat4 inv_mat)
{
    return (inv_mat*vec4(p,1.0)).xyz;
}

vec3 sdf_scale(in vec3 p, in vec3 scale) {
    return p / scale;
}



vec3 twist_z( in vec3 p, in float k, in float b )
{
    float c = cos(k*p.z);
    float s = sin(k*p.z+b);
    mat2  m = mat2(c,-s,s,c);
    vec3  q = vec3(m*p.xy,p.z);
    return q;
}

//funky
// vec3 twist_y( in vec3 p, in float k, in float b )
// {
//     float c = cos(k*p.y);
//     float s = sin(k*p.y*b);
//     mat2  m = mat2(c,-s,s,c);
//     vec3  q = vec3(m*p.xz,p.x);
//     return q;
// }

//also funky
vec3 twist_y( in vec3 p, in float k, in float b )
{
    float c = cos(k*p.y);
    float s = sin(k*p.y+b);
    mat2  m = mat2(c,-s,s,c);
    vec2 pp = m*p.xz;
    return vec3(pp.x, p.y, pp.y);
    //vec3  q = vec3(m*p.yx,p.z);
    //return q;
}

vec3 twist_x( in vec3 p, in float k, in float b )
{
    float c = cos(k*p.x);
    float s = sin(k*p.x+b);
    mat2  m = mat2(c,-s,s,c);
    vec2 pp = m*p.yz;
    return vec3(p.x, pp);//p.y, pp.y);
    //vec3  q = vec3(m*p.yx,p.z);
    //return q;
}

float triangle_wave(in float x, in float k)
{
    k = 1. / k;
    return (k - abs(mod(x, 2.*k) - k))/(k*0.5) - 1.0;
}

float triangle_cos(in float x)
{
    return triangle_wave(x, PI/10.);
}

float triangle_sin(in float x)
{
    return -triangle_wave(x + PI/2., PI/10.);
}


vec3 triangle_twist_z_( in vec3 p, in float k, in float b )
{
    float c = triangle_wave(p.z*k, 1.0)*0.5; //abs(cos(k*p.z));
    float s = triangle_wave(p.z*k + b, 1.0)*0.5; //abs(sin(k*p.z*b));
    mat2  m = mat2(c,-s,s,c);
    vec3  q = vec3(m*p.xy,p.z);
    return q;
}

vec3 triangle_twist_z( in vec3 p, in float k, in float b )
{
    float th1 = triangle_wave(p.z*k, 5.0);
    float th2 = triangle_wave(p.z*k + b, 5.0);

    float c = cos(th1); //abs(cos(k*p.z));
    float s = sin(th2); //triangle_wave(p.x*3 - b, -k); //abs(sin(k*p.z*b));
    mat2  m = mat2(c,-s,s,c);
    vec3  q = vec3(m*p.xy,p.z);
    return q;
}

//------------------------------------------------------------------------------------
#pragma mark LIGHTING

//---------------------------------------------------
// from iq. https://www.shadertoy.com/view/Xds3zN
vec3 calc_normal ( in vec3 p )
{
    //vec3 delta = vec3( 0.004, 0.0, 0.0 );
    vec3 delta = vec3( 2./resolution.x, 0.0, 0.0 );
    int mtl;
    vec3 n;
    n.x = compute_scene( p+delta.xyz, mtl ) - compute_scene( p-delta.xyz, mtl );
    n.y = compute_scene( p+delta.yxz, mtl ) - compute_scene( p-delta.yxz, mtl );
    n.z = compute_scene( p+delta.yzx, mtl ) - compute_scene( p-delta.yzx, mtl );
    return normalize( n );
}

//---------------------------------------------------
#define ambient_occlusion ambient_occlusion1

// from iq. https://www.shadertoy.com/view/Xds3zN
float ambient_occlusion3( in vec3 pos, in vec3 nor )
{
    float occ = 0.0;
    float sca = 1.0;
    int mtl;
    for( int i=0; i<5; i++ )
    {
        float hr = 0.01 + 0.12*float(i)/4.0;
        vec3 aopos =  nor * hr + pos;
        float dd = compute_scene( aopos, mtl );
        occ += -(dd-hr)*sca;
        sca *= 0.95;
    }
    return clamp( 1.0 - 3.0*occ, 0.0, 1.0 );
}


//---------------------------------------------------
float ambient_occlusion2( in vec3 p, vec3 n ) //, float stepDistance, float samples)
{
    const float stepDistance = 0.25;//EPSILON;
    float samples = 5.0;
    float occlusion = 1.0;
    int mtl;
    for (occlusion = 1.0 ; samples > 0.0 ; samples-=1.0) {
        occlusion -= (samples * stepDistance - (compute_scene( p + n * samples * stepDistance, mtl))) / pow(2.0, samples);
    }
    return occlusion;
}

//---------------------------------------------------
float ambient_occlusion1( in vec3 p, in vec3 n ) //, float startweight, float diminishweight )
{
    float startweight=1.;
    float diminishweight=0.3;

    //n = vec3(0.0,1.0,1.0);
    float ao = 0.0;
    float weight = startweight;
    int mtl;
    
    for ( int i = 1; i < 6; ++i )
    {
        float delta = i*i*EPSILON *12.0;
        ao += weight * (delta-compute_scene(p+n*(0.0+delta), mtl));
        weight *= diminishweight;
    }
    
    return 1.0-saturate(ao);
}


//---------------------------------------------------
#define soft_shadow     soft_shadow1

// from iq. https://www.shadertoy.com/view/Xds3zN
float soft_shadow2( in vec3 ro, in vec3 rd, in float mint, in float tmax, float k )
{
    float res = 1.0;
    float t = mint;
    int mtl;
    for( int i=0; i<76; i++ )
    {
        float h = compute_scene( ro + rd*t, mtl );
        res = min( res, k*h/t );
        t += h;//clamp( h, 0.02, 0.10 );
        if( h<0.001 || t>tmax ) break;
    }
    return clamp( res, 0.0, 1.0 );
}


float soft_shadow1( in vec3 p, in vec3 w, float mint, float maxt, float k )
{
    float res = 1.0;
    int mtl;
    for( float t=mint; t < maxt; )
    {
        float h = compute_scene(p + w*t,mtl);
        if( h<0.001 )
            return 0.0;
        res = min( res, k*h/t );
        t += h * 1.0;
    }
    return res;
}

float hard_shadow(in vec3 ro, in vec3 rd, float mint, float maxt) {
    int mtl;
    for(float t=mint; t < maxt;) {
        float h = compute_scene(ro + rd*t, mtl);
        if(h<0.001) return 0.0;
        t += h;
    }
    return 1.0;
}



//------------------------------------------------------------------------------------
#pragma mark RAY MARCHER

//#define compute_color compute_color_pass
vec3 light_dir(vec3 p)
{
    return normalize(light); //mat3(invViewMatrix) * normalize(light); // - p);
}

vec4 compute_color_outline( in vec3 p, in float distance, in int mtl, in float normItCount )
{
    return vec4(1.);
}

vec4 compute_color_pass( in vec3 p, in float distance, in int mtl, in float normItCount )
{
    //return vec4(1.,0.,0.,1.);
    //return vec4(abs(p)/10., 1.);
    vec4 it_clr = vec4(vec3(0.1+normItCount), 1.0) * 2.0;
    //return it_clr;
    //return vec4(distance*100000000);
    vec3 n = calc_normal(p);
    float d = max(0., dot(n, light_dir(p))); //*0.5+0.5;
    //vec4 nclr = vec4(d, d, d, 1.); //(n - 1.)+0.5, 1.);
    float dthresh = (d>thresh)?1:0;
    return vec4(dthresh); 
    return vec4(max(0.5,luminosity(normal_color(n))) * max(0.3,ambient_occlusion1(p, n)*1.3)); // use this to debug normals
    //return vec4(max(0.5,luminosity(normal_color(n))) 
    //* max(0.7,hard_shadow(p, normalize(vec3(1.,0.5,0.)), 0.01, 10.)*1.3)); // use this to debug normals
}

vec4 compute_color_shadow( in vec3 p, in float distance, in int mtl, in float normItCount )
{
    //return vec4(1.,0.,0.,1.);
    //return vec4(abs(p)/10., 1.);
    vec4 it_clr = vec4(vec3(0.1+normItCount), 1.0) * 2.0;
    //return it_clr;
    //return vec4(distance*100000000);
    vec3 n = calc_normal(p);
    float nl = max(0., dot(n, light_dir(p)))*3.; 

    //return vec4(max(0.5,luminosity(normal_color(n))) * max(0.3,ambient_occlusion1(p, n)*1.3)); // use this to debug normals
    return vec4(1. - nl*hard_shadow(p, light_dir(p), 0.1, 10.));
    return vec4(max(0.5,luminosity(normal_color(n))) 
    * max(0.7,hard_shadow(p, light_dir(p), 0.3, 10.)*1.3)); // use this to debug normals
}

vec4 compute_color_preview( in vec3 p, in float distance, in int mtl, in float normItCount )
{
    //return vec4(1.,0.,0.,1.);
    //return vec4(abs(p)/10., 1.);
    vec4 it_clr = vec4(vec3(0.1+normItCount), 1.0) * 2.0;
    //return it_clr;
    //return vec4(distance*100000000);
    vec3 n = calc_normal(p);
    float nl = max(0., dot(n, light_dir(p)))*2.; 

    //return vec4(max(0.5,luminosity(normal_color(n))) * max(0.3,ambient_occlusion1(p, n)*1.3)); // use this to debug normals
    return vec4(max(0.5, nl)*max(0.1, luminosity(normal_color(n)))); //
    //* max(0.1,hard_shadow(p, light_dir(p), 0.1, 10.))); // use this to debug normals
}


// Ray marcher
vec4 trace_ray(in vec3 p, in vec3 w, in vec4 bg_clr, inout float distance)
{
    //    const float maxDistance = 50;//1e10;
    const int maxIterations =256;
    const float closeEnough = 1e-5;
    vec3 rp;
    int mtl;
    float t = 0;
    for (int i = 0; i < maxIterations; ++i)
    {
        rp = p+w*t;
        float d = compute_scene(rp, mtl);
        t += d;
        if (d < closeEnough)
        {
            distance = t;
            // use this to debug number of ray casts
            //return vec4(vec3(float(i)/128.0), 1.0);
//            return mtl == 0 ? vec4(vec3(float(i)/128.0), 1.0) : compute_color(rp,t,mtl);
            return compute_color(rp, t, mtl, float(i) * 1.0/float(maxIterations));//+vec3(float(i)/128.0);
        }
        else if(t > distance)
        {
            return bg_clr;//vec3(0.0);
        }
        
        
    }
    
    return bg_clr; //vec4(1.);//bg_clr;//vec3(0.0); // return skybox here
}

//------------------------------------------------------------------------------------
#pragma mark SCENE

#define blending sdf_blend_exp //poly



//------------------------------------------------------------------------------------

float sdf_box_texture( in vec3 p, in vec3 size, in sampler2D tex )
{
    vec4 clr = texture2D(tex,(p.xz*0.1)+vec2(0.5));
    return sdf_box((p-vec3(0.0,-(clr.r)*333,0.0)),size);
}

// float compute_scene_( in vec3 p, out int mtl )
// {
//     mtl = 0;
//     float d = 1e10;
    
//     d = sdf_union(d, terrain(p));//sdf_xz_plane(p, texture2D(floor_image,p.xz*0.01).x*14.0-20.0));//sin(p.x*0.3)*sin(p.z*0.1)-20.0));//noise(p.xz) * 5.0) );
// //    float d2 = sdf_box_texture( p,vec3(6.0),floor_image );
//     float d2 = sdf_box( p,vec3(6.0) );
//     if(d2<d)
//         mtl = 1;
//     return min(d,d2);
// }

float sdf_replace(float d, float d2)
{
    return d2;
}

float make_form( float d, in vec3 p)
{
    for( int i = 0; i < num_cubes; i++ )
    {
         //d = blending(d, sdf_box(p + box_pos_dir[i].xyz, vec3(0.3)), blend_k);// vec3(0.3)));
         d = sdf_union(d, sdf_box(sdf_transform(p, box_mats[i]), vec3(1.0, 1.0, 1.0)));
         //d = sdf_blend_power(d, sdf_box(p + box_pos[i], box_dir[i]/2), blend_k*10);// vec3(0.3)));
         //d = blending(d, sdf_sphere(p + box_pos_dir[i].xyz, 0.3), blend_k);// vec3(0.3)));
    }   


    // for( int i = 0; i < num_cubes; i++ )
    // {
    //      //d = blending(d, sdf_box(p + box_pos_dir[i].xyz, vec3(0.3)), blend_k);// vec3(0.3)));
    //      d = sdf_subtract(d, sdf_box(p + box_pos[i], box_hole[i]/2));// vec3(0.3)));
    //      //d = blending(d, sdf_box(p + box_pos[i], box_hole[i]/2), blend_k*0.3);// vec3(0.3)));
    //      //d = blending(d, sdf_sphere(p + box_pos_dir[i].xyz, 0.3), blend_k);// vec3(0.3)));
    // }

    return d;
}

float compute_scene( in vec3 p, out int mtl )
{
    mtl = 0;
    float d = 1e10;
    //float blend_k = 1.;
    //d = sdf_union(d, sdf_xz_plane(p, sin(p.x*0.3)*sin(p.z*0.1)));//noise(p.xz) * 5.0) );
//    d = sdf_union(d, sdf_xz_plane(p,  0));


    vec3 q = p; //twist_z(p, 0.6, 0.5);
    for( int i = 0; i < num_cubes; i++ )
    {
         //d = blending(d, sdf_box(p + box_pos_dir[i].xyz, vec3(0.3)), blend_k);// vec3(0.3)));
         d = sdf_union(d, sdf_box(sdf_transform(q, box_mats[i]), vec3(1.0, 1.0, 1.0)));
         //d = sdf_blend_power(d, sdf_box(p + box_pos[i], box_dir[i]/2), blend_k*10);// vec3(0.3)));
         //d = blending(d, sdf_sphere(p + box_pos_dir[i].xyz, 0.3), blend_k);// vec3(0.3)));
    }


    // d = sdf_intersect(d, sdf_box(sdf_translate(
    //                                 sdf_rotate_x(p, radians(45)),
    //                                 vec3(0.0,0.,-0.8)), vec3(0.9)));
    //d = sdf_intersect(d, sdf_sphere(sdf_translate(p, vec3(0.0,0.,-0.8)), 1.6));
    //d = sdf_union(d, sdf_xy_plane(p, -1.8));

    //d = sdf_union(d, sdf_box(sdf_rotate_x(sdf_translate(p, vec3(0,0.5,0.)), 0.3), vec3(2.,2.,2.)));
    // d = sdf_subtract(d, sdf_box(
    //             sdf_translate(
    //                 sdf_rotate_x(p, radians(45)), vec3(0,-1.5,0.)), vec3(2, 0.8, 2)));
    // for( int i = 0; i < num_cubes/2; i++ )
    // {
    //      //d = blending(d, sdf_box(p + box_pos_dir[i].xyz, vec3(0.3)), blend_k);// vec3(0.3)));
    //      d = sdf_subtract(d, sdf_box(p + box_pos[i], box_dir[i]*0.3));// vec3(0.3)));
    //      //d = blending(d, sdf_sphere(p + box_pos_dir[i].xyz, 0.3), blend_k);// vec3(0.3)));
    // }   

    // for( int i = num_cubes/2; i < num_cubes; i++ )
    // {
    //      d = sdf_subtract(d, sdf_box(p + box_pos_dir[i].xyz, vec3(0.03, 3.5, 3.5)));
    // } 
    //d = min(sdf_sphere(p, 1.), d); //min(sdf_sphere(p, 1.), d);
    //d = min(sdf_box(p, vec3(1.)), d);
    //d = blending(d, dguy, blend_k);
    //return 0.8;
    return d;// + texture2D(floor_image, p.xz * floor_scale).r * floor_height - floor_offset;
}


//------------------------------------------------------------------------------------
#pragma mark MAIN
void main(void)
{
    vec2 xy = gl_FragCoord.xy; 
    
    // Primary ray origin
    vec3 p = invViewMatrix[3].xyz;
    // Primary ray direction
    vec3 w = mat3(invViewMatrix) * normalize(
                                             vec3( (xy - resolution / 2.0)*vec2(1.0,1.0), resolution.y/(-2.0*tanHalfFov))
                                             );
    
    float distance = 1e3;
    
    vec4 clr = trace_ray(p, w, vec4(0., 0, 0, 1.), distance);
    //clr = vec4(xy.x/resolution.x, xy.y/resolution.y, 0., 1.);
    //clr.xyz = pow( clr.xyz, vec3(1.0/2.2)); // gamma correction.
    //clr = vec4(abs(p)/50,1.);
    //clr.xyz = texture2D(color_image, vec2(luminosity(clr), 0.0)).xyz;
    
    //clr.w  = 1.0;
    gl_FragColor = clr;
}



