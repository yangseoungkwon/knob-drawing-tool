#include <Adafruit_NeoPixel.h>
#include <Mouse.h>

// ===== Pin map (change to your wiring) =====
static const uint8_t LEFT_ENC_A_PIN = 2;
static const uint8_t LEFT_ENC_B_PIN = 3;
static const uint8_t LEFT_SW_PIN = 4;

static const uint8_t RIGHT_ENC_A_PIN = 6;
static const uint8_t RIGHT_ENC_B_PIN = 7;
static const uint8_t RIGHT_SW_PIN = 8;

static const uint8_t NEOPIXEL_PIN = 29;
static const uint8_t NEOPIXEL_COUNT = 1;

// ===== Motion tuning =====
static const int8_t STEP_PIXELS = 24;     // pixels per encoder detent (target: 20~30)
static const int8_t MAX_DELTA_PER_SEND = 8;
static const uint16_t SEND_INTERVAL_MS = 2;
static const bool INVERT_X = false;
static const bool INVERT_Y = true;

// ===== Button debounce =====
static const uint16_t DEBOUNCE_MS = 20;
static const uint16_t COMBO_WINDOW_MS = 120;

Adafruit_NeoPixel pixels(NEOPIXEL_COUNT, NEOPIXEL_PIN, NEO_GRB + NEO_KHZ800);

struct EncoderState {
  uint8_t pinA;
  uint8_t pinB;
  uint8_t lastAB;
  int32_t quarterSteps;
};

struct ButtonState {
  uint8_t pin;
  bool stablePressed;
  bool lastRawPressed;
  uint32_t lastChangeMs;
  uint32_t lastPressEventMs;
};

EncoderState leftEnc{LEFT_ENC_A_PIN, LEFT_ENC_B_PIN, 0, 0};
EncoderState rightEnc{RIGHT_ENC_A_PIN, RIGHT_ENC_B_PIN, 0, 0};
ButtonState leftBtn{LEFT_SW_PIN, false, false, 0, 0};
ButtonState rightBtn{RIGHT_SW_PIN, false, false, 0, 0};

int16_t pendingDx = 0;
int16_t pendingDy = 0;
uint32_t lastSendMs = 0;

enum LedMode : uint8_t { LED_IDLE, LED_ACTIVITY, LED_CLICK, LED_ERROR };
LedMode ledMode = LED_IDLE;
uint32_t ledUntilMs = 0;

// Gray code transition table:
// prevAB(2-bit) + currAB(2-bit) => -1, 0, +1 quarter-step
static const int8_t kTransitionTable[16] = {
  0, -1, +1, 0,
  +1, 0, 0, -1,
  -1, 0, 0, +1,
  0, +1, -1, 0
};

static inline uint8_t readAB(uint8_t pinA, uint8_t pinB) {
  const uint8_t a = (digitalRead(pinA) == HIGH) ? 1 : 0;
  const uint8_t b = (digitalRead(pinB) == HIGH) ? 1 : 0;
  return static_cast<uint8_t>((a << 1) | b);
}

void setLedColor(uint8_t r, uint8_t g, uint8_t b) {
  pixels.setPixelColor(0, pixels.Color(r, g, b));
  pixels.show();
}

void setLedMode(LedMode mode, uint16_t durationMs = 0) {
  ledMode = mode;
  ledUntilMs = durationMs ? (millis() + durationMs) : 0;
}

void updateLed() {
  if (ledUntilMs && static_cast<int32_t>(millis() - ledUntilMs) >= 0) {
    ledMode = LED_IDLE;
    ledUntilMs = 0;
  }

  switch (ledMode) {
    case LED_IDLE:
      setLedColor(0, 0, 25);  // blue
      break;
    case LED_ACTIVITY:
      setLedColor(0, 25, 0);  // green
      break;
    case LED_CLICK:
      setLedColor(20, 20, 20);  // white
      break;
    case LED_ERROR:
      setLedColor(25, 0, 0);  // red
      break;
  }
}

int8_t pollEncoderQuarterStep(EncoderState &enc) {
  const uint8_t currAB = readAB(enc.pinA, enc.pinB);
  const uint8_t idx = static_cast<uint8_t>((enc.lastAB << 2) | currAB);
  enc.lastAB = currAB;
  return kTransitionTable[idx];
}

void updateEncoder(EncoderState &enc, int16_t &axisPending, bool invertAxis) {
  const int8_t quarter = pollEncoderQuarterStep(enc);
  if (quarter == 0) {
    return;
  }

  enc.quarterSteps += quarter;
  if (enc.quarterSteps >= 4) {
    axisPending += invertAxis ? -STEP_PIXELS : STEP_PIXELS;
    enc.quarterSteps = 0;
    setLedMode(LED_ACTIVITY, 60);
  } else if (enc.quarterSteps <= -4) {
    axisPending += invertAxis ? STEP_PIXELS : -STEP_PIXELS;
    enc.quarterSteps = 0;
    setLedMode(LED_ACTIVITY, 60);
  }
}

bool updateButtonDebounced(ButtonState &btn) {
  const bool rawPressed = (digitalRead(btn.pin) == LOW);  // pull-up active low
  const uint32_t now = millis();

  if (rawPressed != btn.lastRawPressed) {
    btn.lastRawPressed = rawPressed;
    btn.lastChangeMs = now;
  }

  if ((now - btn.lastChangeMs) >= DEBOUNCE_MS && btn.stablePressed != rawPressed) {
    btn.stablePressed = rawPressed;
    if (btn.stablePressed) {
      btn.lastPressEventMs = now;
      return true;
    }
  }
  return false;
}

void handleButtons() {
  const bool leftPressedEvent = updateButtonDebounced(leftBtn);
  const bool rightPressedEvent = updateButtonDebounced(rightBtn);
  const uint32_t now = millis();

  static bool comboFired = false;

  const bool comboNow =
      (leftBtn.stablePressed && rightBtn.stablePressed) ||
      (leftPressedEvent &&
       rightBtn.lastPressEventMs > 0 &&
       (now - rightBtn.lastPressEventMs) <= COMBO_WINDOW_MS) ||
      (rightPressedEvent &&
       leftBtn.lastPressEventMs > 0 &&
       (now - leftBtn.lastPressEventMs) <= COMBO_WINDOW_MS);

  if (comboNow && !comboFired) {
    Mouse.click(MOUSE_MIDDLE);
    setLedMode(LED_CLICK, 180);
    comboFired = true;
    return;
  }

  if (!leftBtn.stablePressed && !rightBtn.stablePressed) {
    comboFired = false;
  }

  if (!comboFired) {
    if (leftPressedEvent) {
      Mouse.click(MOUSE_LEFT);
      setLedMode(LED_CLICK, 120);
    }

    if (rightPressedEvent) {
      Mouse.click(MOUSE_RIGHT);
      setLedMode(LED_CLICK, 120);
    }
  }
}

void sendMouseMoveIfReady() {
  const uint32_t now = millis();
  if ((now - lastSendMs) < SEND_INTERVAL_MS) {
    return;
  }
  lastSendMs = now;

  if (pendingDx == 0 && pendingDy == 0) {
    return;
  }

  const int8_t dx = constrain(pendingDx, -MAX_DELTA_PER_SEND, MAX_DELTA_PER_SEND);
  const int8_t dy = constrain(pendingDy, -MAX_DELTA_PER_SEND, MAX_DELTA_PER_SEND);

  Mouse.move(dx, dy, 0);
  pendingDx -= dx;
  pendingDy -= dy;
}

void setupPins() {
  pinMode(LEFT_ENC_A_PIN, INPUT_PULLUP);
  pinMode(LEFT_ENC_B_PIN, INPUT_PULLUP);
  pinMode(RIGHT_ENC_A_PIN, INPUT_PULLUP);
  pinMode(RIGHT_ENC_B_PIN, INPUT_PULLUP);

  pinMode(LEFT_SW_PIN, INPUT_PULLUP);
  pinMode(RIGHT_SW_PIN, INPUT_PULLUP);

  leftEnc.lastAB = readAB(leftEnc.pinA, leftEnc.pinB);
  rightEnc.lastAB = readAB(rightEnc.pinA, rightEnc.pinB);
}

void setup() {
  setupPins();

  pixels.begin();
  pixels.setBrightness(30);
  pixels.clear();
  pixels.show();

  Mouse.begin();
  setLedMode(LED_IDLE);
}

void loop() {
  updateEncoder(leftEnc, pendingDy, INVERT_Y);   // left knob controls Y
  updateEncoder(rightEnc, pendingDx, INVERT_X);  // right knob controls X

  handleButtons();
  sendMouseMoveIfReady();
  updateLed();
}
