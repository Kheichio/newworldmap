// Entry point: wire up buttons and show the setup screen.
window.addEventListener('DOMContentLoaded', () => {
  initSetup();

  $('btn-wait').onclick = () => playerAction('wait');
  $('btn-center').onclick = centerOnHome;
  $('btn-grid').onclick = () => { UI.renderer.showGrid = !UI.renderer.showGrid; UI.needsDraw = true; };
  $('btn-help').onclick = () => $('help').classList.remove('hidden');
  $('btn-help-close').onclick = () => $('help').classList.add('hidden');
  const newGame = () => {
    $('gameover').classList.add('hidden');
    $('app').classList.add('hidden');
    $('setup').classList.remove('hidden');
    $('in-seed').value = '';
  };
  $('btn-new').onclick = newGame;
  $('btn-go-new').onclick = newGame;
  $('btn-continue').onclick = () => { UI.game.continued = true; $('gameover').classList.add('hidden'); };
});
