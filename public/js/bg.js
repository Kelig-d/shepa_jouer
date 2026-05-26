const canvas = document.getElementById('bg-canvas');
const ctx = canvas.getContext('2d');
let w, h, particles = [];

const COLORS = [
  '0, 240, 255',
  '123, 47, 247',
  '255, 0, 228',
  '0, 230, 118',
];

function resize() {
  w = canvas.width = window.innerWidth;
  h = canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

class Particle {
  constructor() { this.reset(); }
  reset() {
    this.x = Math.random() * w;
    this.y = Math.random() * h;
    this.size = Math.random() * 2.5 + 0.5;
    this.speedX = (Math.random() - 0.5) * 0.4;
    this.speedY = (Math.random() - 0.5) * 0.4;
    this.color = COLORS[Math.floor(Math.random() * COLORS.length)];
    this.opacity = Math.random() * 0.6 + 0.2;
    this.pulseSpeed = Math.random() * 0.02 + 0.005;
    this.pulseOffset = Math.random() * Math.PI * 2;
  }
  update(time) {
    this.x += this.speedX;
    this.y += this.speedY;
    if (this.x < 0 || this.x > w) this.speedX *= -1;
    if (this.y < 0 || this.y > h) this.speedY *= -1;
    this.currentOpacity = this.opacity * (0.6 + 0.4 * Math.sin(time * this.pulseSpeed + this.pulseOffset));
  }
  draw() {
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${this.color}, ${this.currentOpacity})`;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size * 3, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${this.color}, ${this.currentOpacity * 0.1})`;
    ctx.fill();
  }
}

const NUM_PARTICLES = 80;
for (let i = 0; i < NUM_PARTICLES; i++) particles.push(new Particle());

function drawConnections() {
  for (let i = 0; i < particles.length; i++) {
    for (let j = i + 1; j < particles.length; j++) {
      const dx = particles[i].x - particles[j].x;
      const dy = particles[i].y - particles[j].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 150) {
        const alpha = (1 - dist / 150) * 0.12;
        ctx.beginPath();
        ctx.moveTo(particles[i].x, particles[i].y);
        ctx.lineTo(particles[j].x, particles[j].y);
        ctx.strokeStyle = `rgba(0, 240, 255, ${alpha})`;
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
    }
  }
}

let time = 0;
function loop() {
  time++;
  ctx.clearRect(0, 0, w, h);
  for (const p of particles) { p.update(time); p.draw(); }
  drawConnections();
  requestAnimationFrame(loop);
}
loop();
