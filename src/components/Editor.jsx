import React, { useEffect, useState } from 'react'

import { is_ip_valid, ip_regex } from '../utils/ip_tools';
import Cue from '../types/cue';
import DCA from '../types/dca';

// const mixers = await window.presonus.discover();

// console.log(mixers);

let counter = 1;


const Editor = (params) => {

    const [cues, setCues] = useState([]);


    const addCue = () => {
        let new_cue = new Cue(counter++, 0)

        new_cue.setDCA(new DCA(1, [1], "P1", 0, "#000000"));
        new_cue.setDCA(new DCA(2, [2], "P2", -10, "#000000"));
        new_cue.setDCA(new DCA(3, [3], "P3", -20, "#000000"));
        new_cue.setDCA(new DCA(4, [4], "P4", -10, "#000000"));
        new_cue.setDCA(new DCA(5, [5], "P5", 0, "#000000"));
        new_cue.setDCA(new DCA(6, [6], "P6", -10, "#000000"));
        new_cue.setDCA(new DCA(7, [7], "P7", -20, "#000000"));
        new_cue.setDCA(new DCA(8, [8], "P8", -10, "#000000"));

        setCues(prev_cues => [...prev_cues, new_cue])
    }

    useEffect(() => {
        
    }, [])


	return <>
		<table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
        
            {/* Table Header */}
            <thead>
            <tr style={{ backgroundColor: '#f2f2f2' }}>
                <th style={{ padding: '10px', borderBottom: '2px solid #ddd' }}>#</th>
                <th style={{ padding: '10px', borderBottom: '2px solid #ddd' }}>DCA 1</th>
                <th style={{ padding: '10px', borderBottom: '2px solid #ddd' }}>DCA 2</th>
                <th style={{ padding: '10px', borderBottom: '2px solid #ddd' }}>DCA 3</th>
                <th style={{ padding: '10px', borderBottom: '2px solid #ddd' }}>DCA 4</th>
                <th style={{ padding: '10px', borderBottom: '2px solid #ddd' }}>DCA 5</th>
                <th style={{ padding: '10px', borderBottom: '2px solid #ddd' }}>DCA 6</th>
                <th style={{ padding: '10px', borderBottom: '2px solid #ddd' }}>DCA 7</th>
                <th style={{ padding: '10px', borderBottom: '2px solid #ddd' }}>DCA 8</th>
            </tr>
            </thead>
            
            {/* Table Body */}
            <tbody>
            {/* 3. Loop through your data array using .map() */}
            {cues.map((cue) => (
                <tr key={cue.index}>
                    {console.log(cue)}
                    <td style={{ padding: '10px', borderBottom: '1px solid #ddd' }}>{cue.index}.{cue.point}</td>
                    <td style={{ padding: '10px', borderBottom: '1px solid #ddd' }}>{cue.getDCA(1).name}</td>
                    <td style={{ padding: '10px', borderBottom: '1px solid #ddd' }}>{cue.getDCA(2).name}</td>
                    <td style={{ padding: '10px', borderBottom: '1px solid #ddd' }}>{cue.getDCA(3).name}</td>
                    <td style={{ padding: '10px', borderBottom: '1px solid #ddd' }}>{cue.getDCA(4).name}</td>
                    <td style={{ padding: '10px', borderBottom: '1px solid #ddd' }}>{cue.getDCA(5).name}</td>
                    <td style={{ padding: '10px', borderBottom: '1px solid #ddd' }}>{cue.getDCA(6).name}</td>
                    <td style={{ padding: '10px', borderBottom: '1px solid #ddd' }}>{cue.getDCA(7).name}</td>
                    <td style={{ padding: '10px', borderBottom: '1px solid #ddd' }}>{cue.getDCA(8).name}</td>
                </tr>
            ))}
            </tbody>

        </table>
        <button onClick={addCue}>Add</button>
	</>;
}

export default Editor;