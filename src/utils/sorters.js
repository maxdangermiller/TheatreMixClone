/**
 * Sort function for Cues
 * @param {Cue} a Cue 1
 * @param {Cue} b Cue 2
 * @returns Sorting direction
 */
const cue_sorter = (a, b) => {
    const a_num = parseInt(a.number);
    const b_num = parseInt(b.number);
    
    if (a_num > b_num)      {   return 1;   }
    if (a_num < b_num)      {   return -1;  }

    const a_pt = parseInt(a.point);
    const b_pt = parseInt(b.point);
    
    if (a_pt > b_pt)        {   return 1;   }
    if (a_pt < b_pt)        {   return -1;  }
    
    return 0;
}

export {cue_sorter};