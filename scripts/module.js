Hooks.once('ready', () => {
  if(!game.modules.get('lib-wrapper')?.active && game.user.isGM)
      ui.notifications.error("Fudge Player Rolls requires the 'libWrapper' module. Please install and activate it.");
});

const whisperError = (error) => {
  console.error(`Fudge Player Rolls | ${error}`);
  ChatMessage.create({
    user: game.user._id,
    whisper: [game.user._id],
    flavor: "Fudge Player Rolls",
    content: `<div>Error: ${error}</div>`
  });
};

const parseTarget = (target) => {
  let value = parseInt(target)
  if (isNaN(value)) {
    return undefined;
  } else{
    return value;
  }  
};

const parseDialogDoc = (doc) => {
  try {
    const target = parseTarget(doc.find("input[name=target]")[0].value);
    return target;
  } catch (e) {
    console.error(e);
    return undefined;
  }
}

const evaluateTotalVsTarget = (total, target) => {
  return total === target;
};

let wrapperIsRegistered = false;

const onSubmit = async (doc) => {
  const target = parseDialogDoc(doc);
  if (!target) {
    return whisperError("Invalid Target Format");
  }
  console.log(`Fudge Player Rolls | target is ${target}`);

  libWrapper.register('fudge-player-rolls', 'ChatMessage.prototype._onCreate', function (wrapped, ...args) {
    let sender = this.user;
    let theRoll, flavortxt;

    if (this.isRoll && !sender.isGM){ 
      //if the message is a roll sent by a player
      // - call fudgeRoll
      // - since this is the next player roll, unregister this hook
      theRoll = JSON.parse(this.data.roll);
      flavortxt = this.data.flavor;
      fudgeRoll(target, theRoll, sender, flavortxt);
      libWrapper.unregister('fudge-player-rolls', 'ChatMessage.prototype._onCreate');
      wrapperIsRegistered = false;
    }
    //delete the original chat message from the log so that it doesn't display in the chat next time the server is loaded
    ui.chat.deleteMessage(this.data._id); //why doesn't this work?

    return;
  }, 'MIXED' );

}; 

const fudgeRoll = async (target, theRoll, sender, flavortxt) => {
  let formula = theRoll.formula;

  /**
   * Get the Total and minimum possible and maximum possible rolls by looping through theRoll.terms
   *  - create newterms array that will become the total of the modifiers
   *  - create diceterms array that stores only the die expression objects, without the modifiers
   *  - -- define the 'minus' property of the diceterm object, which will tell us later whether we should subtract or add that term
   *  - if the term is a die, add number of dice to the minroll, add number of dice times faces to maxroll.
   *  - sum mods and target to get the total.
   *  - check if total is less than min or greater than max. If so, change total to min or max respectively.
   */
  let newterms = [];
  let diceterms = [];
  let minroll = 0;
  let maxroll = 0;
  for (let i = 0; i<theRoll.terms.length; i++){
    let term = theRoll.terms[i];
    if (term.class == 'Die'){
      diceterms.push(term);
      if (theRoll.terms[i-1] == "-"){ 
        diceterms[diceterms.length-1].minus = true;
      } else{
        diceterms[diceterms.length-1].minus = false;
      }
      newterms[i] = 0;
      let sides = diceterms[diceterms.length-1].faces;
      let num = diceterms[diceterms.length-1].number;
      if (term.minus){
        //if term should be subtracted, -= minroll and maxroll. else, +=
        minroll -= num;
        maxroll -= num*sides;
      }else{
        minroll += num;
        maxroll += num*sides;
      }
    } else{
      newterms[i] = term;
    }
  }
  newterms = newterms.join('');
  let mods = eval(newterms);
  minroll += mods;
  maxroll += mods;
  let total = target;
  if (total < minroll){ 
    total = minroll;
    whisperError(`Total was less than min possible roll. Total changed to ${minroll}`);
  }
  if (total > maxroll){ 
    total = maxroll;
    whisperError(`Total was greater than max possible roll. Total changed to ${maxroll}`);
  }

  /**
   * Set Fake Results
   */
  // add a fakeResult property to each term, that is an array of the fake results for the term.
  // define fakeResults array in each diceterm
  for (let i=0; i<diceterms.length; i++){
    let diceterm = diceterms[i];
    diceterm.fakeResults = [];
  }
  // populate each fakeResult array with its max roll. Do this a num of times = num of dice in the term.
  // in other words, give each die in the term a result in the fakeResults array.
  for (let i=0; i<diceterms.length; i++){
    let diceterm = diceterms[i];
    for (let j=0; j<diceterm.number; j++){
      diceterm.fakeResults.push(diceterm.faces);
    }
  }
  // subtract 1 from each fakeResult until the sum of all fakeResults + mods == total
  adjustFakeResults();

  //Randomize the fake results so that it doesn't show a suspicious roll of all 1s for the smaller dice terms
  randomizeFakeResults();

  //if any dice term has advantage or disadvantage, adjust the first fake result accordingly
  for (let i=0; i<diceterms.length; i++){
    let diceterm = diceterms[i];
    if (diceterm.modifiers.includes('kh')) adjustFirstFakeForAdvDisadv(diceterm, 'adv');
    if (diceterm.modifiers.includes('kl')) adjustFirstFakeForAdvDisadv(diceterm, 'disadv');
  }
  /**
   * 
   * @returns 
   */
  function adjustFakeResults(){
    while (getTotal() != total){
      for (let i=0; i<diceterms.length; i++){
        let diceterm = diceterms[i];
        for (let j=0; j<diceterm.fakeResults.length; j++){
          if (diceterm.fakeResults[j] != 1){
            if (diceterm.modifiers.includes('kh') && j==0) continue;
            if (diceterm.modifiers.includes('kl') && j==0) continue;
            //don't subtract if the fake result is 1, nor if it has adv/disadv and this is the first fake result
            diceterm.fakeResults[j] -= 1;
          }
          if (getTotal() == total){
            return;
          }
        }
      }
    }
  }
  /**
   * 
   * @returns diceTermsTotal+mods
   */
  function getTotal(){
    let diceTermsTotal = 0;
    for (let i=0; i<diceterms.length; i++){
      let diceterm = diceterms[i];
      if (diceterm.minus){
        //if the diceterm should be subtracted, subtract it from diceTermsTotal. else, add it.
        diceTermsTotal -= getFakeResultsTotal(diceterm);
      } else{
        diceTermsTotal += getFakeResultsTotal(diceterm);
      }
    }
    return diceTermsTotal+mods;
  }
  
  /**
   * First, get the amount to distribute to the fake results. This = total of all fake results that aren't 1.
   *  Then set all fake results to 1.
   * Next, distribute the amount to be distributed amongst all fake results.
   *  Loop through all fake results and add a random number to the fake result.
   *    Skip the fake result if:
   *      - the diceterm has adv/disadv and it the first fake result
   *      - the fake result is already at its max (=sides) and thus can't have anything added to it
   *  Do this until there's nothing left to distribute.
   */
  function randomizeFakeResults(){
    //define and set toDistribute
    let toDistribute = 0;
    for (let i=0; i<diceterms.length; i++){
      let diceterm = diceterms[i];
      for (let j=0; j<diceterm.fakeResults.length; j++){
        let fakeResult = diceterm.fakeResults[j];
        //for each fake result
        if (diceterm.modifiers.includes('kh') && j==0) continue;
        if (diceterm.modifiers.includes('kl') && j==0) continue;
        //if it has adv/disadv skip the first result
        if (fakeResult !=1){
          //if subtracting, we don't want it to be distributed, so only add to toDistribute if diceterm.minus is false
          if (!diceterm.minus) toDistribute += fakeResult - 1;
          diceterm.fakeResults[j] = 1;
        }
      }
    }
    while(toDistribute > 0){
      for (let i=0; i<diceterms.length; i++){
        let diceterm = diceterms[i];
        for (let j=0; j<diceterm.fakeResults.length; j++){
          let fakeResult = diceterm.fakeResults[j];
          //for each fake result
          if (diceterm.modifiers.includes('kh') && j==0) continue;
          if (diceterm.modifiers.includes('kl') && j==0) continue;
          //if it has adv/disadv skip the first result
          let addToFakeResult = randNumFromToDistribute(diceterm.faces - fakeResult, toDistribute);
          diceterm.fakeResults[j] += addToFakeResult;
          if (diceterm.minus) toDistribute += addToFakeResult; //if subtracting, we need to take what we added to the fake result and put it elsewhere to make up for it
          if (!diceterm.minus) toDistribute -= addToFakeResult;
        }
      }
    }
    //if the equation has both added and subtracted dice, it will not have met the total yet
    //  So, do the above all over again, but this time only on the subtracted dice.
    if (getTotal() != total){
      toDistribute = getTotal() - total;
      if (toDistribute <= 0){
        whisperError(`Something went wrong.`);
        return;
      }
      while(toDistribute > 0){
        for (let i=0; i<diceterms.length; i++){
          let diceterm = diceterms[i];
          if (!diceterm.minus) continue;//skip it if it's not getting subtracted
          for (let j=0; j<diceterm.fakeResults.length; j++){
            let fakeResult = diceterm.fakeResults[j];
            //for each fake result
            if (diceterm.modifiers.includes('kh') && j==0) continue;
            if (diceterm.modifiers.includes('kl') && j==0) continue;
            //if it has adv/disadv skip the first result
            let addToFakeResult = randNumFromToDistribute(diceterm.faces - fakeResult, toDistribute);
            diceterm.fakeResults[j] += addToFakeResult;
            toDistribute -= addToFakeResult;
          }
        }
      }
    }
  }
  
  /**
   * 
   * @param {*} sides 
   * @param {*} toDistribute 
   * @returns a random number between 1 and either diceterm.faces or toDistribute (whichever is lower)
   */
  function randNumFromToDistribute(sidesMinusFake, toDistribute){
    let min = 0;
    let max;
    if (sidesMinusFake < toDistribute){
      max = sidesMinusFake;
    } else{
      max = toDistribute;
    }
    //pick a random number between min and max
    let randNum = Math.floor(Math.random() * (max - min + 1) + min);
    if (toDistribute == 0) randNum = 0; //this prevents toDistribute from going to -1 and screwing everything up
    return randNum;
  }


  let tooltip = `<div class="dice-tooltip">`;
  for (let i=0; i<diceterms.length; i++){
    let diceterm = diceterms[i];
    let sides = diceterm.faces;
    let num = diceterm.number;
    let dieFormula = `${num}d${sides}`;
    if (diceterm.modifiers.includes('kh')) dieFormula += 'kh';
    if (diceterm.modifiers.includes('kl')) dieFormula += 'kl';
    

    let htmlStart = `
      <section class="tooltip-part">
        <div class="dice">
          <header class="part-header flexrow">
            <span class="part-formula">${dieFormula}</span>
            <span class="part-total">${getFakeResultsTotal(diceterm)}</span>
          </header>
          <ol class="dice-rolls">
    `;
    tooltip += htmlStart;

    let htmlListItems = '';
    //loop through diceterm.fakeresults and add an li for each one
    //if the diceterm has adv/disadv
    // - add the 'discarded' class to the first fake result's li
    for (let j=0; j<diceterm.fakeResults.length; j++){
      if(diceterm.modifiers.includes('kh') && j==0 || diceterm.modifiers.includes('kl') && j==0){
        htmlListItems += `<li class="roll die d${sides} discarded">${diceterm.fakeResults[j]}</li>`;
      } else{
        htmlListItems += `<li class="roll die d${sides}">${diceterm.fakeResults[j]}</li>`;
      }
    }
    tooltip += htmlListItems;

    let htmlEnd = `
          </ol>
        </div>
      </section>
    `;
    tooltip += htmlEnd;
  }
  tooltip += '</div>';

  /**
   * 
   * @param {*} diceterm 
   * @param {string|string} advORdis 
   */
  function adjustFirstFakeForAdvDisadv(diceterm, advORdis){
    if (advORdis == 'adv'){
      //advantage
      //make the first fake result's value higher than the rest of the fake results
      // - loop through diceterms.fakeResults
      //    - get the highest value, ignoring the first fake result
      //    - if the highest value == diceterm.faces set the first fake result to diceterm.faces
      //    -   else set the first fake result to 1 higher than the highest fake result.
      let highestFakeResult = 0;
      for (let i=1; i<diceterm.fakeResults.length; i++){
        //note: i=1 bc we need to skip the first fake result (which is the one we're discareding), which is currently set to the max
        let fakeResult = diceterm.fakeResults[i];
        if (fakeResult > highestFakeResult) highestFakeResult = fakeResult;
      }
      if (highestFakeResult == diceterm.faces){
        diceterm.fakeResults[0] = diceterm.faces;
      }else{
        diceterm.fakeResults[0] = highestFakeResult - 1;
      }
    } 
    if (advORdis == 'disadv'){
      //disadvantage
      //make the first fake result's value lower than the rest of the fake results
      let lowestFakeResult = diceterm.faces;
      for (let i=1; i<diceterm.fakeResults.length; i++){
        //note: i=1 bc we need to skip the first fake result (which is the one we're discareding), which is currently set to 1
        let fakeResult = diceterm.fakeResults[i];
        if (fakeResult < lowestFakeResult) lowestFakeResult = fakeResult;
      }
      if (lowestFakeResult == 1){
        diceterm.fakeResults[0] = 1;
      }else{
        diceterm.fakeResults[0] = lowestFakeResult + 1;
      }
    }
  }

  /**
   * 
   * @param {*} diceterm 
   * @returns 
   */
  function getFakeResultsTotal(diceterm){
    let total = diceterm.fakeResults.reduce(function(a,b){
      return a+b;
    });
    //if has advantage or disadvantage, subtract the first fake result from the total (since we're discarding it)
    if (diceterm.modifiers.includes('kh') || diceterm.modifiers.includes('kl')) total -= diceterm.fakeResults[0];
    return total;
  }

  //define the content of the chat message
  let content = `
    <div class="dice-roll">
      <div class="dice-result">
        <div class="dice-formula">${formula}</div>  
        ${tooltip}  
        <h4 class="dice-total">${getTotal()}</h4>
      </div>
    </div>
  `;

  //create the chat message
  let messagedata = {
      user: sender,
      content: content,
      flavor: flavortxt,
      sound: CONFIG.sounds.dice
  }
  ChatMessage.create(messagedata);
}

const showDialog = async () => {
  const html = await renderTemplate("/modules/fudge-player-rolls/templates/dialog.html");
  return new Promise((resolve) => {
    new Dialog({
      title: "Fudge Next Player Roll",
      content: html,
      buttons: {
        fudge: {
          label: "Fudge it!",
          callback: async (input) => {
            resolve(await onSubmit(input));
          }
        }
      },
      default: "fudge",
      close: () => resolve(null),
      render: (doc) => {
        doc.find("input[name=target]")[0].focus();
      }
    }).render(true);
  });
}

const showUnsetDialog = async() => {
  const html = `<p>You have already set a target. What do you want to do?</p>`;
  return new Promise((resolve) => {
    new Dialog({
      title: "Fudge Target Is Already Set",
      content: html,
      buttons: {
        unset: {
          label: "Erase It",
          callback: async() => {
            //unset my libwrapper
            resolve(eraseExistingTarget());
          }
        },
        reset: {
          label: "Replace It",
          callback: async() => {
            //unregister my libwrapper
            //call showDialog
            resolve(replaceExistingTarget());
          }
        },
        cancel: {
          label: "Keep It",
          callback: async() => {
            //do nothing
            resolve(console.log('Fudge Player Rolls | Fudge target was kept as is.'));
          }
        }
      },
      default: "cancel",
      close: () => resolve(null)
    }).render(true);
  });
}

function eraseExistingTarget(){
  console.log('Fudge Player Rolls | Erasing fudge target');
  libWrapper.unregister('fudge-player-rolls', 'ChatMessage.prototype._onCreate');
  wrapperIsRegistered = false;
}

function replaceExistingTarget(){
  console.log('Fudge Player Rolls | Replacing fudge target');
  libWrapper.unregister('fudge-player-rolls', 'ChatMessage.prototype._onCreate');
  wrapperIsRegistered = false;
  showDialog();
}

Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user.isGM) {
    return;
  }

  const bar = controls.find((c) => c.name === "token");
  bar.tools.push({
    name: "fudge-player-rolls",
    title: "Fudge Player Roll",
    icon: "fas fa-poop",
    onClick: () => {
        if (wrapperIsRegistered){
          showUnsetDialog();
        }else {
          showDialog();
          wrapperIsRegistered = true;
        }
    },
    button: true
  });
});
