object HOSxPPCUAccount2LMPEntryForm: THOSxPPCUAccount2LMPEntryForm
  Left = 0
  Top = 0
  Caption = 'HOSxPPCUAccount2LMPEntryForm'
  ClientHeight = 196
  ClientWidth = 406
  Color = clBtnFace
  Font.Charset = DEFAULT_CHARSET
  Font.Color = clWindowText
  Font.Height = -16
  Font.Name = 'Tahoma'
  Font.Style = []
  OldCreateOrder = False
  Position = poMainFormCenter
  PixelsPerInch = 96
  TextHeight = 19
  object JvNavPanelHeader1: TJvNavPanelHeader
    Left = 0
    Top = 0
    Width = 406
    Height = 43
    Align = alTop
    Caption = '  '#3619#3632#3610#3640#3592#3635#3609#3623#3609#3629#3634#3607#3636#3605#3618#3660'/'#3623#3633#3609
    Font.Charset = DEFAULT_CHARSET
    Font.Color = clWhite
    Font.Height = -16
    Font.Name = 'Tahoma'
    Font.Style = [fsBold]
    ParentFont = False
    ImageIndex = 0
    ExplicitWidth = 824
  end
  object Panel1: TPanel
    Left = 0
    Top = 155
    Width = 406
    Height = 41
    Align = alBottom
    BevelInner = bvRaised
    BevelOuter = bvLowered
    TabOrder = 1
    ExplicitLeft = 375
    ExplicitTop = 296
    ExplicitWidth = 185
    DesignSize = (
      406
      41)
    object cxButton1: TcxButton
      Left = 317
      Top = 8
      Width = 75
      Height = 25
      Anchors = [akTop, akRight]
      Caption = #3605#3585#3621#3591
      TabOrder = 0
      OnClick = cxButton1Click
      ExplicitLeft = 292
    end
  end
  object cxGroupBox1: TcxGroupBox
    Left = 0
    Top = 43
    Align = alClient
    Caption = 'GA'
    TabOrder = 2
    ExplicitLeft = 337
    ExplicitTop = 216
    ExplicitWidth = 185
    ExplicitHeight = 105
    Height = 112
    Width = 406
    object cxSpinEdit1: TcxSpinEdit
      Left = 32
      Top = 43
      Properties.Alignment.Horz = taCenter
      TabOrder = 0
      Width = 70
    end
    object cxSpinEdit2: TcxSpinEdit
      Left = 171
      Top = 43
      Properties.Alignment.Horz = taCenter
      TabOrder = 1
      Width = 70
    end
    object cxLabel1: TcxLabel
      Left = 108
      Top = 44
      Caption = 'Weeks'
      Transparent = True
    end
    object cxLabel2: TcxLabel
      Left = 247
      Top = 44
      Caption = 'Days'
      Transparent = True
    end
  end
end
