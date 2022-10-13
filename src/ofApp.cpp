#include "ofApp.h"
#include "ofxImGui.h"

struct Transform{
  std::string kind;
  glm::vec3 vals;
};

static bool show_reference = false;
static bool show_grid = true;
static bool three_dee = false;

static double t = 0.0;

static glm::vec2 object_pos(0.0f, 0.0f);
static glm::vec2 object_scale(1.0f, 1.0f);
static glm::vec3 rot_xyz(1.0f, 0.0f, 0.5f);
static bool uniform_scale = true;
static ofTrueTypeFont font_big;
static ofTrueTypeFont font_med;
static ofShader shad;
static ofxImGui::Gui gui; // because ImGui is great
static float ref_size=100.0;
static std::vector<Transform> transforms;

static void draw_object();


void setOrtho(float w, float h, float zNear=-2, float zFar=100) {
  glMatrixMode(GL_PROJECTION);
  glLoadIdentity();
  float x=0, y=0;
  glOrtho(x, x + w, y + h, y, zNear, zFar);
  glMatrixMode(GL_MODELVIEW);
  glLoadIdentity();
}


//--------------------------------------------------------------
void ofApp::setup(){
  ofSetFrameRate(60);
  gui.setup();
  font_big.load("lucidagrande.ttf", 20);
  font_med.load("lucidagrande.ttf", 14);
  
  shad.load("quad.vert", "sdf_renderer.frag");
}

//--------------------------------------------------------------
void ofApp::update(){
}

float quantize(float v, float step, bool pass=false){
  if (pass)
    return v;
  return roundf(v / step) * step;
}

glm::vec2 quantize(const glm::vec2& v, float step, bool pass){
  return glm::vec2(quantize(v.x, step, pass), quantize(v.y, step, pass));
}

static void draw_grid() {
  // make sure we always have a grid regardless of window size
  float w = quantize(ofGetWidth()/2 + ref_size, ref_size);
  float h = quantize(ofGetHeight()/2 + ref_size, ref_size);
  float x = 0, y = 0;
  ofSetColor(255, 255, 255, 10);
  ofNoFill();
  ofDrawLine(x, -h, x, h);
  while (x < w){
    x += ref_size;
    ofDrawLine(x, -h, x, h);
    ofDrawLine(-x, -h, -x, h);
  }
  ofDrawLine(-w, y, w, y);
  while (y < h){
    y += ref_size;
    ofDrawLine(-w, y, w, y);
    ofDrawLine(-w, -y, w, -y);
  }
}

static void reference_frame(float alpha=255){
  /// Draw current reference frame (in 3d)
  
  // keep area/volume of arrow head constant
  glm::mat3 m = ofGetCurrentMatrix(OF_MATRIX_MODELVIEW);
  float s = sqrt(glm::determinant(m));
  
  float l = ref_size;
  float a = (l*0.1)/s;
  
  ofFill();
  ofSetColor(255.0, 0.0, 0.0, alpha);
  ofDrawLine(glm::vec2(0,0), glm::vec2(l,0));
  ofPushMatrix();
  ofRotateZDeg(90);
  ofDrawCone(glm::vec3(0,-l,0), a, a*2);
  ofPopMatrix();
  
  ofSetColor(0.0, 255.0, 0, alpha);
  ofDrawLine(glm::vec2(0,0), glm::vec2(0,l));
  ofPushMatrix();
  ofRotateZDeg(180);
  ofDrawCone(glm::vec3(0,-l,0), a, a*2);
  ofPopMatrix();
  
  ofSetColor(0.0, 0.0, 255.0, alpha);
  ofDrawLine(glm::vec3(0,0,0), glm::vec3(0,0,l));
  ofPushMatrix();
  ofRotateXDeg(-90);
  ofDrawCone(glm::vec3(0,-l,0), a, a*2);
  ofPopMatrix();
}

//--------------------------------------------------------------
/// App modes

static void rts_mode(){
  static float rot = 0.0;
  static glm::vec2 trans(0.0, 0.0);
  static glm::vec2 trans2(0.0, 0.0);
  static glm::vec2 scale(1.0, 1.0);
  static bool uniform_scale=true;
  static bool do_quantize=false;
  static bool show_steps=false;
  ImGui::Checkbox("Quantize", &do_quantize);
  ImGui::Checkbox("Show steps", &show_steps);
  
  ImGui::SliderFloat("Rotation (radians)", &rot, 0.0, PI*2);
  ImGui::SliderFloat2("Translation", &trans.x, 0, 700);
  ImGui::SliderFloat2("Scale", &scale.x, 0.1, 20); ImGui::SameLine();
  ImGui::Checkbox("Uniform", &uniform_scale);
  ImGui::SliderFloat2("Translation2", &trans2.x, 0.0, 700);
  //ImGui::ArrowButton("Up", ImGuiDir_Up); ImGui::SameLine(); ImGui::ArrowButton("Down", ImGuiDir_Down);
  
  if (uniform_scale)
    scale.y = scale.x;
  
  scale = quantize(scale, 0.25, !do_quantize);
  trans = quantize(trans, ref_size*0.5, !do_quantize);
  trans2 = quantize(trans2, ref_size*0.5, !do_quantize);
  
  float step_alpha = 50;
  ofPushMatrix();
  ofRotateRad(rot);
  if (show_steps) reference_frame(step_alpha);
  ofTranslate(trans);
  if (show_steps) reference_frame(step_alpha);
  ofScale(scale.x, scale.y);
  if (show_steps) reference_frame(step_alpha);
  ofTranslate(trans2);
  //if (show_steps) reference_frame(step_alpha);
  draw_object();
  ofPopMatrix();
}

static void tsr_mode(){
  static float rot = 0.0;
  static glm::vec2 trans(0.0, 0.0);
  static glm::vec2 scale(1.0, 1.0);
  static bool uniform_scale=false;
  
  ImGui::SliderFloat("Rot radians", &rot, 0.0, PI*2);
  ImGui::SliderFloat2("Pos", &trans.x, -700, 700);
  ImGui::SliderFloat2("Scale", &scale.x, 0.1, 20); ImGui::SameLine();
  ImGui::Checkbox("Uniform", &uniform_scale);
  if (uniform_scale)
    scale.y = scale.x;
  
  ofTranslate(trans);
  ofScale(scale.x, scale.y);
  ofRotateRad(rot);
  draw_object();
}

static void trs_mode(){
  static float rot = 0.0;
  static glm::vec2 trans(0.0, 0.0);
  static glm::vec2 scale(1.0, 1.0);
  static bool uniform_scale=true;
  
  ImGui::SliderFloat("Rot radians", &rot, 0.0, PI*2);
  ImGui::SliderFloat2("Position", &trans.x, -700, 700);
  ImGui::SliderFloat2("Scale", &scale.x, 0.1, 20); ImGui::SameLine();
  ImGui::Checkbox("Uniform", &uniform_scale);
  if (uniform_scale)
    scale.y = scale.x;
  
  ofTranslate(trans);
  ofRotateRad(rot);
  ofScale(scale.x, scale.y);
  draw_object();
}


static void tentacle_mode(){
  static float rotation_range = 1.0; //PI/4;
  static float base_rotation = 0; //PI/4;
  static float dist = 100.0;
  static float anim_speed = 1.0;
  static float rot_speed = 0.0;
  static float phase = 0.9;
  static float scale_factor = 0.9;
  static int num_joints = 7;
  static int num_tentacles = 9;
  
  ImGui::SliderInt("Num joints", &num_joints, 1, 10);
  ImGui::SliderInt("Num tentacles", &num_tentacles, 1, 40);
  ImGui::SliderFloat("Base rotation", &base_rotation, 0.0, PI*2);
  ImGui::SliderFloat("Rot range", &rotation_range, 0.0, PI*2);
  ImGui::SliderFloat("Joint distance", &dist, 10.0, 200.0);
  ImGui::SliderFloat("Phase", &phase, 0.0, PI);
  ImGui::SliderFloat("Wiggle speed", &anim_speed, 0.0, 1.0);
  ImGui::SliderFloat("Rot speed", &rot_speed, -1.0, 1.0);
  
  ImGui::SliderFloat("Scale factor", &scale_factor, 0.5, 1.0);
  
  ofPushMatrix();
  ofRotateRad(t*rot_speed); // rotate the whole scene around center
  for (int i = 0; i < num_tentacles; i++){
    float scale = 1.0;
    float rot_step = (PI*2) / num_tentacles;
    ofPushMatrix();
    ofRotateRad(rot_step*i); // rotate each tentacle
    //draw_object();
    for (int j = 0; j < num_joints; j++){
      // rotate each joint incrementally along tentacle
      // and then translate along rotated reference frame by a given distance
      ofRotateRad(base_rotation + sin(t*anim_speed + phase*j + PI/2)*rotation_range);
      
      // and eventually scale as we go along
      ofScale(scale);
      draw_object();
      
      ofTranslate(dist, 0);
      //ofScale(scale);
      
      scale *= scale_factor;
    }
    ofPopMatrix();
  }
  ofPopMatrix();
}


//--------------------------------------------------------------
// object modes
static void draw_rect(){
  ofNoFill();
  ofSetColor(ofColor(255.0, 255.0, 255.0));
  float size = 100;
  //ofDrawBox(glm::vec3(0,0,0), size, size, size);
  ofDrawRectangle(-size*0.5, -size*0.5, size, size);
}

static void draw_rect_side(){
  ofNoFill();
  ofSetColor(ofColor(255.0, 255.0, 255.0));
  float size = 100;
  //ofDrawBox(glm::vec3(0,0,0), size, size, size);
  ofDrawRectangle(0, -size*0.25, size, size*0.5);
}


static void draw_rotating_rects(){
  ofNoFill();
  ofSetColor(ofColor(255.0, 255.0, 255.0));
  float size = 20;
  int n = 7;
  float rot_step = (PI*2) / n;
  for (int i = 0; i < n; i++){
    ofPushMatrix();
    ofRotateRad(rot_step*i + t*0.5);
    ofDrawRectangle(100, -size*0.5, size, size);
    ofPopMatrix();
  }
}

static void draw_box(){
  ofNoFill();
  ofSetColor(ofColor(255.0, 255.0, 255.0));
  float size = 100;
  ofDrawBox(glm::vec3(0,0,0), size, size, size);
  //ofDrawRectangle(-size*0.5, -size*0.5, size, size);
}

static void draw_rotating_box(){
  ofNoFill();
  ofSetColor(ofColor(255.0, 255.0, 255.0));
  float size = 100;
  ofRotateXRad(t*0.1);
  ofRotateZRad(t*0.21);
  
  ofDrawBox(glm::vec3(0,0,0), size, size, size);
  //ofDrawRectangle(-size*0.5, -size*0.5, size, size);
}




struct Mode{
  std::string name;
  std::string subtitle;
  void (*cb)();
};
static int cur_mode = 0;
static int cur_object = 2;

std::vector<Mode> modes = {
  {"A tentacle", "Composition of transformations and animation", &tentacle_mode},
  {"Transformations", "Translate -> Rotate -> Scale", &trs_mode},
  {"Order matters!", "Translate -> Scale -> Rotate", &tsr_mode},
  {"Order matters!", "Rotate -> Translate -> Scale", &rts_mode},
};

std::vector<Mode> objects = {
  {"Rectangle", "A rectangle", &draw_rect},
  {"Rotating rectangles", "Rotating rectangle", &draw_rotating_rects},
  {"Side rectangle", "A rectangle", &draw_rect_side},
  {"Box 3d", "A 3d box", &draw_box},
  {"Rotating box 3d", "A 3d box", &draw_rotating_box}
};


static void draw_object(){
  if (show_reference)
    reference_frame();
  ofPushMatrix();
  ofTranslate(object_pos);
  ofScale(object_scale.x, object_scale.y);
  objects[cur_object].cb();
  ofPopMatrix();
}

// Add also kinematic chain
// For instance leg like item, repeat in circle
static bool ModeCombo(const char* label, int* current_item, const std::vector<Mode>& items )
{
    std::string str = "";
    for( int i = 0; i < items.size(); i++ )
    {
        str += items[i].name;
        str += (char)0;
    }
    return ImGui::Combo(label, current_item, str.c_str());
}


//--------------------------------------------------------------
void ofApp::draw(){
  static float theta = 0.0;
  static float scale_x=1.0, scale_y=1.0;
  
  t = ofGetElapsedTimef();
  
  gui.begin();
  ImGui::Checkbox("Show reference frame", &show_reference);
  ImGui::Checkbox("Show grid", &show_grid);
  ImGui::Checkbox("3D", &three_dee);
  ModeCombo("Object:", &cur_object, objects);
  ImGui::SliderFloat3("Rotation 3d", &rot_xyz.x, 0, PI*2);
  ImGui::SliderFloat2("Object pos", &object_pos.x, -100, 100);
  ImGui::SliderFloat2("Object scale", &object_scale.x, 0.1, 20); ImGui::SameLine();
  ImGui::Checkbox("Uniform", &uniform_scale);
  if (uniform_scale){
    object_scale.y = object_scale.x;
  }
  
  if (ModeCombo("Mode:", &cur_mode, modes)){
    if (cur_mode==0)
      cur_object = 2;
  }

  if (!three_dee)
    setOrtho(ofGetWidth(), ofGetHeight());

  ofSetColor(255, 255, 255);
  font_big.drawString(modes[cur_mode].name, 50, 50);
  ofSetColor(0, 128, 255);
  font_med.drawString(modes[cur_mode].subtitle, 50, 100);
  
  ofTranslate(glm::vec2(ofGetWidth()/2, ofGetHeight()/2));
  if (three_dee){
    ofRotateXRad(rot_xyz.x);
    ofRotateZRad(rot_xyz.z);
    ofRotateYRad(rot_xyz.y);
  }
  
  
  //ofGetCurrent
  
  if (show_grid)
    draw_grid();
  reference_frame(90);
  
  ImGui::PushID("Mode");
  modes[cur_mode].cb();
  ImGui::PopID();
  
  gui.end();
}

//--------------------------------------------------------------
void ofApp::keyPressed(int key){

}

//--------------------------------------------------------------
void ofApp::keyReleased(int key){

}

//--------------------------------------------------------------
void ofApp::mouseMoved(int x, int y ){

}

//--------------------------------------------------------------
void ofApp::mouseDragged(int x, int y, int button){

}

//--------------------------------------------------------------
void ofApp::mousePressed(int x, int y, int button){

}

//--------------------------------------------------------------
void ofApp::mouseReleased(int x, int y, int button){

}

//--------------------------------------------------------------
void ofApp::mouseEntered(int x, int y){

}

//--------------------------------------------------------------
void ofApp::mouseExited(int x, int y){

}

//--------------------------------------------------------------
void ofApp::windowResized(int w, int h){

}

//--------------------------------------------------------------
void ofApp::gotMessage(ofMessage msg){

}

//--------------------------------------------------------------
void ofApp::dragEvent(ofDragInfo dragInfo){

}
