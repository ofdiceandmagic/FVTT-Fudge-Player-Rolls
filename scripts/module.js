//define variables
let sender, theRoll, flavortxt, content, formula, total, fakeRoll, target;

//register settings
Hooks.on('ready', async() => {
  game.settings.register("fudge-player-rolls", "target-is-set", {
    name: "Is the fudge target set?",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
    onChange: () => console.log('Fudge Player Rolls | setting "target-is-set" was changed')
  });

  game.settings.register("fudge-player-rolls", "target", {
    name: "What is the fudge total?",
    scope: "world",
    config: false,
    default: 0,
    type: Number,
    onChange: () => console.log('Fudge Player Rolls | setting "target" was changed')
  });
});

//set the target-is-set and total settings to false and 0
Hooks.on('ready', () => {
  //CONFIG.debug.hooks = true;
  game.settings.set("fudge-player-rolls", "target-is-set", false);
  game.settings.set("fudge-player-rolls", "target", 0);
});

const whisperError = (error) => {
  console.warn(`Fudge Player Rolls (whisperError) | ${error}`);
  ChatMessage.create({
    user: game.user.id,
    whisper: [game.user.id],
    flavor: `Fudge Player Rolls`,
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
    console.log('Fudge Player Rolls (parseDialogDoc) | target is ', target);
    return target;
  } catch (e) {
    console.error(e);
    return undefined;
  }
}

const onSubmit = async (doc) => {
  target = parseDialogDoc(doc);
  if (isNaN(target)) {
    game.settings.set('fudge-player-rolls', 'target-is-set', false);
    return whisperError("Invalid Target Format");
  }
  //save the target to the server
  game.settings.set("fudge-player-rolls", "target", target);

  console.log(`Fudge Player Rolls (onSubmit) | target is ${target}`);

  //set the fudge target state to true
  game.settings.set('fudge-player-rolls', 'target-is-set', true);
};

Hooks.on('preCreateChatMessage',(document) => {
  sender = document.data.speaker;
  target = game.settings.get("fudge-player-rolls", "target"); //get the target from the server
  console.log('Fudge Player Rolls (preCreateChatMessage) | target = ', target);
  console.log('Fudge Player Rolls (preCreateChatMessage) | message is a roll = ', document.isRoll);
  console.log('Fudge Player Rolls (preCreateChatMessage) | target (settings) = ', game.settings.get('fudge-player-rolls', 'target-is-set'));

  if (document.user.isGM) {
    console.log('Fudge Player Rolls | user is GM. Roll not fudged.');
    return;
  }

  if (game.settings.get('fudge-player-rolls', 'target-is-set') && document.isRoll){
    console.log('Fudge Player Rolls | message is a roll and a target is set');
    //if the message is a roll sent by a player and a target is set
    // - call fudgeRoll
    // - since this is the next player roll, change target-is-set to false
    theRoll = JSON.parse(document.data.roll);
    flavortxt = document.data.flavor;
    fudgeRoll(target, theRoll, sender, flavortxt, document);
    //update the chat data
    document.data.update({
      speaker: sender,
      content: content, 
      flavor: flavortxt
    });

    console.log(`Fudge Player Rolls | Roll was fudged.`); 
    
    return;
  }
});

Hooks.on('createChatMessage', (doc) => {
  //set fudge target state to false
  //the players don't have permission to update the setting, so we need to do it on the GM's client.
  //the createChatMessage hook is called on the GM's client even when a player rolls so we just need to check if the chat message is a fudged roll.
  if (game.user.isGM){
    let message = doc.data.content;
    if (message.includes( '<div class="dice-tooltip fudged-roll">' )){
      //if it's a fudged roll, 
      game.settings.set('fudge-player-rolls', 'target-is-set', false);
    }
  }
});

const fudgeRoll = async (target, theRoll, sender, flavortxt, document) => {
  formula = theRoll.formula;

  /**
   * Get the Total, minimum possible and maximum possible rolls by looping through theRoll.terms
   *  - create modterms array that will become the total of the modifiers
   *  - create diceterms array that stores only the die expression objects, without the modifiers
   *  - -- define the 'minus' property of the diceterm object, which will tell us later whether we should subtract or add that term
   *  - if the term is a die, add number of dice to the minroll, add number of dice times faces to maxroll.
   *  - sum mods and target to get the total.
   *  - check if total is less than min or greater than max. If so, change total to min or max respectively.
   */
  //define diceterms, mods, minroll and maxroll
  let modterms = [];
  let diceterms = [];
  let minroll = 0;
  let maxroll = 0;
  for (let i = 0; i<theRoll.terms.length; i++){
    let term = theRoll.terms[i];
    if (term.class == 'Die'){
      diceterms.push(term);
      if (i>0 && theRoll.terms[i-1].class == 'OperatorTerm' && theRoll.terms[i-1].operator == "-"){ 
        diceterms[diceterms.length-1].minus = true;
      } else if (i>0 && theRoll.terms[i-1].class == 'OperatorTerm' && theRoll.terms[i-1].operator == "+") {
        diceterms[diceterms.length-1].minus = false;
      }
      modterms[i] = 0;
      let sides = diceterms[diceterms.length-1].faces;
      let num = diceterms[diceterms.length-1].number;
      let minmaxNum = num;
      if ( (term.modifiers.includes('kh') || term.modifiers.includes('kl')) && term.number > 1 ){ //term.number has to be greater than one, otherwise if they enter 1d20kh this will set the min/max roll to 0
        //if it has adv/dis, subtract 1 from the number of dice
        minmaxNum = num - 1;
      }
      if (term.minus){
        //if term should be subtracted, -= minroll and maxroll. else, +=
        minroll -= minmaxNum;
        maxroll -= minmaxNum*sides;
      }else{
        minroll += minmaxNum;
        maxroll += minmaxNum*sides;
      }
    } else if (term.class == 'NumericTerm') {
      modterms[i] = term.number;
    } else if (term.class == 'OperatorTerm') {
      modterms[i] = term.operator;
    }
  }
  modterms = modterms.join('');
  console.log(`modterms = `, modterms);
  let mods = eval(modterms);
  minroll += mods;
  maxroll += mods;
  total = target;
  if (total < minroll){ 
    total = minroll;
  }
  if (total > maxroll){ 
    total = maxroll;
  }
  console.log('Fudge Player Rolls | total = ', total);

  //loop through all dice terms. If any have adv/dis and its num is 1, change the num to 2.
  for (let i=0; i<diceterms.length; i++){
    let diceterm = diceterms[i];
    if ( (diceterm.modifiers.includes('kh') || diceterm.modifiers.includes('kl')) && diceterm.number == 1) diceterm.number = 2;
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

  console.log('diceterms = ', diceterms);

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
    return diceTermsTotal + mods;
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


  let tooltip = `<div class="dice-tooltip fudged-roll">`;
  for (let i=0; i<diceterms.length; i++){
    let diceterm = diceterms[i];
    let sides = diceterm.faces;
    let num = diceterm.number;
    //if it includes kh or kl and the num == 1, make the num 2.
    if ( (diceterm.modifiers.includes('kh') || diceterm.modifiers.includes('kl')) && num == 1 ) num = 2;
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
    // - add max/min/critical/fumble classes if necessary
    for (let j=0; j<diceterm.fakeResults.length; j++){
      if(diceterm.modifiers.includes('kh') && j==0 || diceterm.modifiers.includes('kl') && j==0){
        htmlListItems += `<li class="roll die d${sides} discarded">${diceterm.fakeResults[j]}</li>`;
      } else if( (diceterm.modifiers.includes('kh') && j==0 || diceterm.modifiers.includes('kl') && j==0) && diceterm.fakeResults[j] == diceterm.faces ){
        //if it has adv/dis and its the max roll
        htmlListItems += `<li class="roll die d${sides} max discarded">${diceterm.fakeResults[j]}</li>`;
      } else if ( (diceterm.modifiers.includes('kh') && j==0 || diceterm.modifiers.includes('kl') && j==0) && diceterm.fakeResults[j] == 1 ){
        //if it has adv/dis and its 1
        htmlListItems += `<li class="roll die d${sides} min discarded">${diceterm.fakeResults[j]}</li>`;
      }else if (diceterm.fakeResults[j] == diceterm.faces){
        //if its not adv/dis and its the max roll
        htmlListItems += `<li class="roll die d${sides} max">${diceterm.fakeResults[j]}</li>`;
      }else if(diceterm.fakeResults[j] == 1){
        //if its not adv/dis and its 1
        htmlListItems += `<li class="roll die d${sides} min">${diceterm.fakeResults[j]}</li>`;
      }
      else{
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
      if (highestFakeResult == 1){
        diceterm.fakeResults[0] = 1;
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
      if (lowestFakeResult == diceterm.faces){
        diceterm.fakeResults[0] = diceterm.faces;
      }else{
        diceterm.fakeResults[0] = lowestFakeResult + 1;
      }
    }
  }

  /**
   * 
   * @param {*} diceterm 
   * @returns total
   */
  function getFakeResultsTotal(diceterm){
    let total = diceterm.fakeResults.reduce(function(a,b){
      return a+b;
    });
    //if has advantage or disadvantage, subtract the first fake result from the total (since we're discarding it)
    if (diceterm.modifiers.includes('kh') || diceterm.modifiers.includes('kl')) total -= diceterm.fakeResults[0];
    return total;
  }

  //if its a crit or fumble give it the appropriate class
  //  if the first die term is 1d20 and its modifiers doesn't include kh or kl and it's result is 20
  //      give it the critical class 
  //  if "" result is 1
  //      give it the fumble class
  //  if the first die term is a d20 and its modifiers do include kh or kl and one of the results other than the first result is  20
  //      give it the critical class
  //  "" result is  1
  //      give it the fumble class
  let htmlResult;
  console.log(`total = ${getTotal()}`);
  if (diceterms[0].faces == 20 && diceterms[0].number == 1 && 
      !( diceterms[0].modifiers.includes('kh') || diceterms[0].modifiers.includes('kl') ) &&
      diceterms[0].fakeResults[0] == 20
    ){ 
      htmlResult = `<h4 class="dice-total critical" style="color:green">${getTotal()}</h4>`;
    } 
  else if (diceterms[0].faces == 20 && diceterms[0].number == 1 &&
      !( diceterms[0].modifiers.includes('kh') || diceterms[0].modifiers.includes('kl') ) &&
      diceterms[0].fakeResults[0] == 1
    ){ 
      htmlResult = `<h4 class="dice-total fumble" style="color:red">${getTotal()}</h4>`;
    } 
  else if (diceterms[0].faces == 20 && 
      ( diceterms[0].modifiers.includes('kh') || diceterms[0].modifiers.includes('kl') )
    ){
      //check if 1 of the results other than the first result is 20 or 1
      let foundAtwenty = false;
      let foundAone = false;
      for (let i=1; i<diceterms[0].fakeResults.length; i++){
        let fakeResult = diceterms[0].fakeResults[i];
        if (fakeResult == 20) foundAtwenty = true;
        if (fakeResult == 1) foundAone = true;
      }
      if (foundAone === true){
        htmlResult = `<h4 class="dice-total fumble" style="color:red">${getTotal()}</h4>`;
      } else if (foundAtwenty === true){
        htmlResult = `<h4 class="dice-total critical" style="color:green">${getTotal()}</h4>`;
      } else{
        htmlResult = `<h4 class="dice-total">${getTotal()}</h4>`;
      }
    }
  else{
      htmlResult = `<h4 class="dice-total">${getTotal()}</h4>`;
    }
  tooltip += htmlResult;

  //define the content of the chat message
  content = `
    <div class="dice-roll">
      <div class="dice-result">
        <div class="dice-formula">${formula}</div>  
        ${tooltip}  
      </div>
    </div>
  `;
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

const showUnsetDialog = async () => {
  const html = `<p>You have already set a target. What do you want to do?</p>`;
  return new Promise((resolve) => {
    new Dialog({
      title: "Fudge Target Is Already Set",
      content: html,
      buttons: {
        unset: {
          label: "Erase It",
          callback: async() => {
            //turn target off
            resolve(eraseExistingTarget());
          }
        },
        reset: {
          label: "Replace It",
          callback: async() => {
            //turn target off and call showDialog
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
  game.settings.set('fudge-player-rolls', 'target-is-set', false);
  console.log('Fudge Player Rolls | Fudge target erased.');
  console.log('Fudge Player Rolls (eraseExistingTarget) | target is ', target);
}

function replaceExistingTarget(){
  console.log('Fudge Player Rolls | Replacing fudge target');
  game.settings.set('fudge-player-rolls', 'target-is-set', false);
  console.log('Fudge Player Rolls (replaceExistingTarget) | target is ', game.settings.get('fudge-player-rolls', 'target-is-set'));
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
        if (game.settings.get('fudge-player-rolls', 'target-is-set')){
          //if a target is already set
          showUnsetDialog();
        }else {
          //target is off (a target isn't set)
          showDialog();
          console.log(`Fudge Player Rolls (after showDialog) | target is ${game.settings.get('fudge-player-rolls', 'target')}`);
        }
    },
    button: true
  });
});