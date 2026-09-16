// Only served by server.py --test-mode. Does not access a physical camera.
(() => {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  const ctx = canvas.getContext('2d');
  let count = 0;
  const query = new URLSearchParams(location.search),
    pose = new Image();
  if (query.has('pose'))
    pose.src = '/__test__/pose.jpg' + (query.get('pose') === 'hands' ? '?hands' : '');
  function draw() {
    ctx.fillStyle = '#192331';
    ctx.fillRect(0, 0, 640, 360);
    if (pose.complete && pose.naturalWidth) ctx.drawImage(pose, 0, 0, 640, 360);
    ctx.fillStyle = '#ff2020';
    ctx.beginPath();
    ctx.arc(320 + 120 * Math.sin(count / 30), 180, 18, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = 'white';
    ctx.font = '14px sans-serif';
    ctx.fillText('SYNTHETIC TEST INPUT', 15, 330);
    count++;
  }
  draw();
  setInterval(draw, 1000 / 30);
  navigator.mediaDevices.getUserMedia = async () => canvas.captureStream(30);
})();
