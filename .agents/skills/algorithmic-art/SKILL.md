---
name: algorithmic-art
description: Creating algorithmic art using p5.js with seeded randomness and interactive parameter exploration. Use this when users request creating art using code, generative art, algorithmic art, flow fields, or particle systems. Create original algorithmic art rather than copying existing artists' work to avoid copyright violations.
license: Complete terms in LICENSE.txt
---

Algorithmic philosophies are computational aesthetic movements that are then expressed through code. Output .md files (philosophy), .html files (interactive viewer), and .js files (generative algorithms).

This happens in two steps:
1. Algorithmic Philosophy Creation (.md file)
2. Express by creating p5.js generative art (.html + .js files)

### THE CRITICAL UNDERSTANDING
- What is received: Some subtle input or instructions by the user to take into account, but use as a foundation; it should not constrain creative freedom.
- What is created: An algorithmic philosophy/generative aesthetic movement.
- What happens next: The same version receives the philosophy and EXPRESSES IT IN CODE - creating p5.js sketches that are 90% algorithmic generation, 10% essential parameters.

The philosophy must emphasize: Algorithmic expression. Emergent behavior. Computational beauty. Seeded variation.

### HOW TO GENERATE AN ALGORITHMIC PHILOSOPHY
**Name the movement** (1-2 words): "Organic Turbulence" / "Quantum Harmonics" / "Emergent Stillness"

**Articulate the philosophy** (4-6 paragraphs):

To capture the ALGORITHMIC essence, express how this philosophy manifests through:
- Computational processes and mathematical relationships
- Noise functions and randomness patterns
- Particle behaviors and field dynamics
- Temporal evolution and system states
- Parametric variation and emergent complexity

**CRITICAL GUIDELINES:**
- **Emphasize craftsmanship REPEATEDLY**: Phrases like "meticulously crafted algorithm," "the product of deep computational expertise," "painstaking optimization," "master-level implementation."
- **Leave creative space**: Be specific about the algorithmic direction, but concise enough that there is room to make interpretive implementation choices.

### PHILOSOPHY EXAMPLES
**"Organic Turbulence"** - Flow fields driven by layered Perlin noise. Thousands of particles following vector forces.

**"Quantum Harmonics"** - Particles on a grid, phases interfering to create wave-like patterns.

**"Recursive Whispers"** - Branching structures that subdivide recursively, constrained by golden ratios.

---

## P5.JS IMPLEMENTATION

### ⚠️ STEP 0: READ THE TEMPLATE FIRST ⚠️
**CRITICAL: BEFORE writing any HTML:**
1. **Read** `templates/viewer.html` using the Read tool
2. **Study** the exact structure, styling, and Anthropic branding
3. **Use that file as the LITERAL STARTING POINT**
4. **Keep all FIXED sections exactly as shown**

### TECHNICAL REQUIREMENTS
**Seeded Randomness (Art Blocks Pattern)**:
```javascript
let seed = 12345;
randomSeed(seed);
noiseSeed(seed);
```

**Parameter Structure**:
```javascript
let params = {
  seed: 12345,
  // Add parameters that control YOUR algorithm:
  // - Quantities, Scales, Probabilities, Ratios, Angles, Thresholds
};
```

**Canvas Setup**:
```javascript
function setup() {
  createCanvas(1200, 1200);
}

function draw() {
  // Your generative algorithm
}
```

### CRAFTSMANSHIP REQUIREMENTS
**CRITICAL**: Create algorithms that feel like they emerged through countless iterations by a master generative artist.

- **Balance**: Complexity without visual noise, order without rigidity
- **Color Harmony**: Thoughtful palettes, not random RGB values
- **Composition**: Even in randomness, maintain visual hierarchy and flow
- **Performance**: Smooth execution, optimized for real-time if animated
- **Reproducibility**: Same seed ALWAYS produces identical output

### REQUIRED FEATURES
**1. Parameter Controls** - Sliders for numeric parameters, color pickers, real-time updates

**2. Seed Navigation** - Display current seed, Prev/Next/Random buttons, jump to specific seed

**3. Single Artifact Structure** - Self-contained HTML with p5.js from CDN

**4. Actions** - Regenerate, Reset, Download PNG buttons

---

## VARIATIONS & EXPLORATION
The artifact includes seed navigation by default, allowing users to explore variations without creating multiple files.

## THE CREATIVE PROCESS
**User request** → **Algorithmic philosophy** → **Implementation**

Each request is unique. The process involves:
1. **Interpret the user's intent** - What aesthetic is being sought?
2. **Create an algorithmic philosophy** (4-6 paragraphs)
3. **Implement it in code**
4. **Design appropriate parameters**
5. **Build matching UI controls**
