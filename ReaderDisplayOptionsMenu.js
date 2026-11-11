'use strict';

import PropTypes from 'prop-types';

import React from 'react';
import {
  Text,
  TouchableOpacity,
  View,
  Image,
  Animated,
} from 'react-native';
import styles from './Styles.js';
import strings from './LocalizedStrings';
import { VOCALIZATION } from './VocalizationEnum';
import {iconData} from "./IconData";
import PrintCopyLink from './PrintCopyLink';

const menuIconNames = ['a_aleph', 'a_icon', 'a_icon_small', 'aleph', 'breaks', 'continuous', 'stacked', 'sidebyside', 'sidebysiderev']

class ReaderDisplayOptionsMenu extends React.Component {
  static whyDidYouRender = true;
  static propTypes = {
    theme:                           PropTypes.object,
    textFlow:                        PropTypes.oneOf(['segmented', 'continuous']),
    canHaveAliyot:                   PropTypes.bool.isRequired,
    canBeContinuous:                 PropTypes.bool.isRequired,
    vowelToggleAvailable:            PropTypes.oneOf([VOCALIZATION.TAAMIM_AND_NIKKUD, VOCALIZATION.NIKKUD, VOCALIZATION.NONE]),
    interfaceLanguage:               PropTypes.oneOf(['hebrew', 'english']).isRequired,
    textLanguage:                    PropTypes.oneOf(['hebrew', 'english', 'bilingual']),
    themeStr:                        PropTypes.oneOf(['white', 'black']),
    showAliyot:                      PropTypes.bool.isRequired,
    setTextFlow:                     PropTypes.func,
    setTextLanguage:                 PropTypes.func,
    setAliyot:                       PropTypes.func,
    incrementFont:                   PropTypes.func,
    setTheme:                        PropTypes.func,
    // "Under each passage": commentaries/targumim available for this sefer ([{key, en, he}])
    inlineSources:                   PropTypes.array,
    // ...or one kind of connection, each text under its line ([{key: "@Tanakh", en, he}])
    inlineConnections:               PropTypes.array,
    inlineCommentary:                PropTypes.string,
    setInlineCommentary:             PropTypes.func,
    // nikud by computer (Dicta) for this sefer's texts without nikud (reader/nakdanPrefs.js)
    nakdanAvailable:                 PropTypes.bool,
    nakdanForCommentary:             PropTypes.bool,   // the text has nikud: the switch is for the commentary
    nakdan:                          PropTypes.bool,
    setNakdan:                       PropTypes.func,
    splitViewAvailable:              PropTypes.bool,
    splitView:                       PropTypes.bool,
    setSplitView:                    PropTypes.func,
    topOffset:                       PropTypes.number,
    // the book being read: "Order a printed copy" when Sofer sells it (PrintCopyLink.js)
    bookTitle:                       PropTypes.string,
    bookHeTitle:                     PropTypes.string,
  };
  constructor(props) {
    super(props);
    this._position = new Animated.Value(0);
  }

  show = () => {
    Animated.timing(this._position, {
      toValue: 1,
      duration: 250,
      useNativeDriver: false,
    }).start();
  };

  hide = (cb) => {
    Animated.timing(this._position, {
      toValue: 0,
      duration: 250,
      useNativeDriver: false,
    }).start(cb);
  };

  renderInlineChoices(choices, isHeb, langStyle) {
    return (
        <View style={{paddingHorizontal: 10, paddingTop: 6, flexDirection: isHeb ? 'row-reverse' : 'row', flexWrap: 'wrap', justifyContent: 'center'}}>
          {choices.map(src => {
            const selected = (this.props.inlineCommentary || null) === src.key;
            return (
              <TouchableOpacity
                key={src.key || '|none'}
                onPress={() => this.props.setInlineCommentary(src.key)}
                accessibilityState={{selected}}
                style={[styles.readerDisplayOptionsMenuItem, this.props.theme.readerDisplayOptionsMenuItem,
                        {flex: 0, height: undefined, minHeight: 40, maxWidth: '100%', paddingHorizontal: 12, paddingVertical: 4, marginHorizontal: 3, marginVertical: 3, borderRadius: 5},
                        selected ? this.props.theme.readerDisplayOptionsMenuItemSelected : null]}>
                <Text numberOfLines={2} style={[isHeb ? styles.he : langStyle, {fontSize: isHeb ? 18 : 14, flexShrink: 1, textAlign: 'center'}, this.props.theme.secondaryText]}>{isHeb ? src.he : src.en}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
    );
  }

  renderInlineSources() {
    // "Under each passage": show a commentary/targum under every segment like a translation, or
    // (as the owner's extension offers) one kind of connection, each text under its line
    const sources = this.props.inlineSources || [];
    const connections = this.props.inlineConnections || [];
    if ((!sources.length && !connections.length) || !this.props.setInlineCommentary) { return null; }
    const isHeb = this.props.interfaceLanguage === "hebrew";
    const langStyle = isHeb ? styles.heInt : styles.enInt;
    const none = {key: null, en: strings.reader.inline_none, he: strings.reader.inline_none};
    const groupLabel = label => (
      <Text style={[langStyle, {textAlign: "center", fontSize: 12, marginTop: 6}, this.props.theme.tertiaryText]}>{label}</Text>
    );
    return (
      <View style={{marginTop: 4, marginBottom: 8}}>
        <Text style={[langStyle, {textAlign: "center"}, this.props.theme.secondaryText]}>{strings.reader.under_each_passage}</Text>
        {/* wraps onto more lines (a horizontal strip cut long names such as "Targum Jonathan on Genesis" off at the edge) */}
        {connections.length && sources.length ? groupLabel(strings.reader.inline_commentaries) : null}
        {this.renderInlineChoices([none, ...sources], isHeb, langStyle)}
        {connections.length ? groupLabel(strings.reader.inline_connections) : null}
        {connections.length ? this.renderInlineChoices(connections, isHeb, langStyle) : null}
      </View>
    );
  }

  render() {
    const icons = menuIconNames.reduce((accum, iconName) => {
      accum[iconName] = iconData.get(iconName, this.props.themeStr);
      return accum;
    }, {});
    const options = [
      {
        label: strings.reader.language,
        onPress: this.props.setTextLanguage,
        buttons: ["english","bilingual","hebrew"],
        icons: [icons.a_icon, icons.a_aleph, icons.aleph],
        currVal: this.props.textLanguage,
        parametrized: true
      },
      {
        condition: this.props.canBeContinuous,
        label: strings.reader.layout,
        onPress: this.props.setTextFlow,
        buttons: ["segmented","continuous"],
        icons: [icons.breaks, icons.continuous],
        currVal: this.props.textFlow,
        parametrized: true
      },
      {
        condition: this.props.textLanguage === 'bilingual',
        label: strings.reader.bilingual_layout,
        onPress: this.props.setBiLayout,
        buttons: ["stacked", "sidebyside", "sidebysiderev"],
        icons: [icons.stacked, icons.sidebyside, icons.sidebysiderev],
        currVal: this.props.biLayout,
        parametrized: true,
        iconLength: 19,
      },
      {
        label: strings.reader.color,
        onPress: this.props.setTheme,
        buttons:["white","black"],
        colors:["#ffffff", "#444444"],
        currVal: this.props.themeStr,
        parametrized: true
      },
      {
        condition: this.props.canHaveAliyot,
        label: strings.reader.aliyot,
        onPress: this.props.setAliyot,
        buttons:[true, false],
        text: [strings.common.on, strings.common.off],
        currVal: this.props.showAliyot,
        parametrized: true,
      },
      {
        label: strings.reader.font_size,
        onPress: this.props.incrementFont,
        buttons:["smaller","larger"],
        icons: [icons.a_icon_small, icons.a_icon],
        currVal: null,
        parametrized: true
      },
      {
        condition: this.props.vowelToggleAvailable < VOCALIZATION.NONE,
        label: this.props.vowelToggleAvailable === VOCALIZATION.TAAMIM_AND_NIKKUD ? strings.reader.vocalization : strings.reader.vowels,
        onPress: this.props.setVocalization,
        buttons:[VOCALIZATION.TAAMIM_AND_NIKKUD, VOCALIZATION.NIKKUD, VOCALIZATION.NONE].slice(this.props.vowelToggleAvailable),
        text: ["אָ֑", "אָ", "א"].slice(this.props.vowelToggleAvailable),
        textStyle: [styles.he, {fontSize: 26}],
        currVal: Math.max(this.props.vocalization, this.props.vowelToggleAvailable),
        parametrized: true,
      },
      {
        // nikud by computer (Dicta), this sefer's own switch, as in the owner's extension: "Vowels"
        // where the text has none, "Commentary vowels" beside its own
        condition: !!this.props.nakdanAvailable && !!this.props.setNakdan,
        label: this.props.nakdanForCommentary ? strings.reader.nakdan_commentary_vowels : strings.reader.nakdan_vowels,
        onPress: this.props.setNakdan,
        buttons: [true, false],
        text: [strings.common.on, strings.common.off],
        currVal: !!this.props.nakdan,
        parametrized: true,
      },
      {
        condition: !!this.props.splitViewAvailable && !!this.props.setSplitView,
        label: strings.tabs.split_view,
        onPress: this.props.setSplitView,
        buttons: [true, false],
        text: [strings.common.on, strings.common.off],
        currVal: !!this.props.splitView,
        parametrized: true,
      },
    ];
    const alignments = [["left","right"],["left","center","right"]];
    let toggleSets = []; // two toggle sets per row
    const rows = [];
    for (let j = 0; j < options.length; j++) {
      let optionRow = options[j];
      let row = [];
      let isColor = "colors" in optionRow;
      if (typeof optionRow.condition == 'undefined' || optionRow.condition) {
        for (let i = 0; i < optionRow.buttons.length; i++) {
          let option = optionRow.buttons[i];
          let selected = optionRow.currVal === option;
  
          if (isColor) {
            let color = optionRow.colors[i];
            row.push(
              <ReaderDisplayOptionsMenuColor
                key={option}
                theme={this.props.theme}
                option={option}
                onPress={optionRow.onPress}
                parametrized={optionRow.parametrized}
                color={color}
                align={alignments[optionRow.buttons.length-2][i]}
                selected={selected} />
            );
          } else {
            const icon = !!optionRow.icons ? optionRow.icons[i] : null;
            const text = !!optionRow.text ? optionRow.text[i] : null;
            row.push(
              <ReaderDisplayOptionsMenuItem
                key={option}
                theme={this.props.theme}
                option={option}
                onPress={optionRow.onPress}
                parametrized={optionRow.parametrized}
                icon={icon}
                iconLength={optionRow.iconLength}
                text={text}
                textStyle={optionRow.textStyle}
                align={alignments[optionRow.buttons.length-2][i]}
                selected={selected}
                interfaceLanguage={this.props.interfaceLanguage} />
            );
          }
        }
        toggleSets.push(<ReaderDisplayOptionsMenuToggleSet key={optionRow.label + "|toggleSet"} label={optionRow.label} content={row} colorRow={isColor} theme={this.props.theme} interfaceLanguage={this.props.interfaceLanguage}/>);
      }
      if (toggleSets.length % 2 === 0 || j === options.length - 1) {
        rows.push(<ReaderDisplayOptionsMenuRow key={optionRow.label + "|row"} content={toggleSets.slice(0)} />);
        toggleSets = [];
      }
    }
    const myStyles = [
      styles.readerDisplayOptionsMenu,
      this.props.theme.readerDisplayOptionsMenu,
      {
        top: this._position.interpolate({
          inputRange: [0, 1],
          outputRange: [-600, 0],
          extrapolate: 'clamp',
        }),
      },
    ];
    return (
      <View style={[styles.readerDisplayOptionsMenuMask, this.props.topOffset ? {top: this.props.topOffset} : null]}>
        <Animated.View style={myStyles}>
            {rows}
            {this.renderInlineSources()}
            {this.props.bookTitle ? <PrintCopyLink title={this.props.bookTitle} heTitle={this.props.bookHeTitle} style={{marginBottom: 6}} /> : null}
        </Animated.View>
      </View>
    );
  }
}

class ReaderDisplayOptionsMenuRow extends React.Component {
    render() {
      return (<View style={styles.readerDisplayOptionsMenuRow}>
        {this.props.content}
      </View>);
    }
}

class ReaderDisplayOptionsMenuToggleSet extends React.Component {
  render() {
    //styles.readerDisplayOptionMenuRowNotColor is a hack required to solve the problem of react native / ios display not yet properly rendering borderRadius & borderWidth w/o 'smearing'
    const tempStyles = this.props.colorRow ? [styles.readerDisplayOptionsMenuToggleSet] : [styles.readerDisplayOptionsMenuToggleSet,styles.readerDisplayOptionMenuToggleSetNotColor,this.props.theme.readerDisplayOptionsMenuDivider];
    const langStyle = this.props.interfaceLanguage === "hebrew" ? styles.heInt : styles.enInt;
    return (
      <View style={styles.readerDisplayOptionsMenuToggleSetOuter}>
        <Text style={[langStyle, {textAlign: "center"}, this.props.theme.secondaryText]}>{this.props.label}</Text>
        <View style={tempStyles}>
          {this.props.content}
        </View>
      </View>
    );
  }
}

class ReaderDisplayOptionsMenuItem extends React.Component {
  static propTypes = {
    theme:        PropTypes.object,
    option:       PropTypes.oneOfType([PropTypes.string, PropTypes.bool, PropTypes.number]),
    icon:         PropTypes.number, /*PTP: why are images numbers? */
    iconLength:   PropTypes.number,
    text:         PropTypes.string,
    textStyle:    PropTypes.array,
    align:        PropTypes.string,
    onPress:      PropTypes.func.isRequired,
    parametrized: PropTypes.bool, /* should onPress() use option as a paremeter*/
    selected:     PropTypes.bool
  };

  render() {
    const langStyle = this.props.interfaceLanguage === "hebrew" ? styles.heInt : styles.enInt;
    let alignStyle;
    if (this.props.align == "right") alignStyle = styles.readerDisplayOptionsMenuItemRight;
    else if (this.props.align == "left") alignStyle = styles.readerDisplayOptionsMenuItemLeft;
    else /*if (this.props.align == "center") */ alignStyle = styles.readerDisplayOptionsMenuItemCenter;

    var onPress = this.props.parametrized ? (()=>this.props.onPress(this.props.option)) : this.props.onPress;
    var tempStyles = [styles.readerDisplayOptionsMenuItem, this.props.theme.readerDisplayOptionsMenuItem, alignStyle];
    if (this.props.selected) {
      tempStyles.push(this.props.theme.readerDisplayOptionsMenuItemSelected);
    }
    const iconStyles = [styles.readerDisplayOptionsMenuIcon];
    if (this.props.iconLength) {
      iconStyles.push({width: this.props.iconLength, height: this.props.iconLength});
    }
    return (
      <TouchableOpacity onPress={onPress} style={tempStyles}>
        {this.props.icon ?
          <Image resizeMode={'contain'} style={iconStyles} source={this.props.icon}/> :
          <Text style={[langStyle, this.props.theme.secondaryText].concat(this.props.textStyle)}>{this.props.text}</Text>
        }
      </TouchableOpacity>
    );
  }
}

class ReaderDisplayOptionsMenuColor extends React.Component {
  static propTypes = {
    theme:        PropTypes.object,
    option:       PropTypes.string,
    color:        PropTypes.string,
    align:        PropTypes.string,
    onPress:      PropTypes.func.isRequired,
    parametrized: PropTypes.bool, /* should onPress() use option as a paremeter*/
    selected:     PropTypes.bool
  };

  render() {
    let alignStyle;
    if (this.props.align == "right") alignStyle = styles.readerDisplayOptionsMenuColorRight;
    else if (this.props.align == "left") alignStyle = styles.readerDisplayOptionsMenuColorLeft;
    else /*if (this.props.align == "center") */ alignStyle = styles.readerDisplayOptionsMenuColorCenter;

    var onPress = this.props.parametrized ? (()=>this.props.onPress(this.props.option)) : this.props.onPress;
    var tempStyles = [styles.readerDisplayOptionsMenuColor, this.props.theme.readerDisplayOptionsMenuColor, {"backgroundColor": this.props.color}, alignStyle];
    if (this.props.selected) {
      tempStyles.push(styles.readerDisplayOptionsMenuColorSelected);
    }
    return (
      <TouchableOpacity onPress={onPress} style={tempStyles}/>
    );
  }
}


export default ReaderDisplayOptionsMenu;
