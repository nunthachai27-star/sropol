object HOSxPPCUAccount2ANCServiceEntryFrame: THOSxPPCUAccount2ANCServiceEntryFrame
  Left = 0
  Top = 0
  Width = 863
  Height = 697
  Font.Charset = DEFAULT_CHARSET
  Font.Color = clWindowText
  Font.Height = -13
  Font.Name = 'Tahoma'
  Font.Style = []
  ParentFont = False
  TabOrder = 0
  object cxPageControl1: TcxPageControl
    Left = 0
    Top = 0
    Width = 863
    Height = 697
    Align = alClient
    TabOrder = 0
    Properties.ActivePage = VisitTabSheet
    Properties.CustomButtons.Buttons = <>
    Properties.Rotate = True
    Properties.TabPosition = tpLeft
    ClientRectBottom = 697
    ClientRectLeft = 102
    ClientRectRight = 863
    ClientRectTop = 0
    object VisitTabSheet: TcxTabSheet
      Caption = #3585#3634#3619#3619#3633#3610#3610#3619#3636#3585#3634#3619
      ImageIndex = 2
      object dxLayoutControl2: TdxLayoutControl
        Left = 0
        Top = 0
        Width = 761
        Height = 697
        Align = alClient
        TabOrder = 0
        LayoutLookAndFeel = dxLayoutSkinLookAndFeel1
        object PatientInformationDetailGroupBox: TcxGroupBox
          Left = 5
          Top = 5
          Caption = #3586#3657#3629#3617#3641#3621#3612#3641#3657#3619#3633#3610#3610#3619#3636#3585#3634#3619
          TabOrder = 0
          Height = 142
          Width = 751
        end
        object VisitGroupBox: TcxGroupBox
          Left = 5
          Top = 154
          Caption = #3585#3634#3619#3619#3633#3610#3610#3619#3636#3585#3634#3619
          TabOrder = 1
          Height = 246
          Width = 751
        end
        object cxGroupBox4: TcxGroupBox
          Left = 5
          Top = 407
          Caption = #3585#3634#3619#3617#3634#3619#3633#3610#3610#3619#3636#3585#3634#3619#3605#3619#3623#3592#3585#3656#3629#3609#3588#3621#3629#3604
          TabOrder = 2
          Height = 146
          Width = 751
          object Label10: TLabel
            Left = 12
            Top = 68
            Width = 102
            Height = 16
            Caption = #3611#3619#3632#3648#3616#3607#3585#3634#3619#3617#3634#3605#3619#3623#3592
            Transparent = True
          end
          object Label12: TLabel
            Left = 297
            Top = 68
            Width = 39
            Height = 16
            Caption = #3626#3606#3634#3609#3607#3637#3656
            Transparent = True
          end
          object Label13: TLabel
            Left = 66
            Top = 98
            Width = 50
            Height = 16
            Caption = #3627#3617#3634#3618#3648#3627#3605#3640
            Transparent = True
          end
          object Label14: TLabel
            Left = 77
            Top = 38
            Width = 37
            Height = 16
            Caption = #3623#3633#3609#3607#3637#3656#3617#3634
            Transparent = True
          end
          object Label15: TLabel
            Left = 312
            Top = 38
            Width = 24
            Height = 16
            Caption = #3648#3623#3621#3634
          end
          object cxDBLookupComboBox4: TcxDBLookupComboBox
            Left = 120
            Top = 65
            DataBinding.DataField = 'anc_service_type_id'
            DataBinding.DataSource = PersonANCServiceDS
            Properties.IncrementalFilteringOptions = [ifoHighlightSearchText, ifoUseContainsOperator]
            Properties.KeyFieldNames = 'anc_service_type_id'
            Properties.ListColumns = <
              item
                FieldName = 'anc_service_type_name'
              end>
            Properties.ListSource = HOSxPPCUAccount2DataModule.ANCServiceTypeDS
            TabOrder = 0
            Width = 166
          end
          object cxDBLookupComboBox5: TcxDBLookupComboBox
            Left = 341
            Top = 65
            DataBinding.DataField = 'anc_location_type_id'
            DataBinding.DataSource = PersonANCServiceDS
            Properties.IncrementalFilteringOptions = [ifoHighlightSearchText, ifoUseContainsOperator]
            Properties.KeyFieldNames = 'anc_location_type_id'
            Properties.ListColumns = <
              item
                FieldName = 'anc_location_type_name'
              end>
            Properties.ListSource = HOSxPPCUAccount2DataModule.ANCLocationTypeDS
            TabOrder = 1
            Width = 233
          end
          object cxDBTextEdit6: TcxDBTextEdit
            Left = 120
            Top = 95
            DataBinding.DataField = 'anc_service_note'
            DataBinding.DataSource = PersonANCServiceDS
            TabOrder = 2
            Width = 454
          end
          object cxDBDateEdit1: TcxDBDateEdit
            Left = 120
            Top = 35
            DataBinding.DataField = 'anc_service_date'
            DataBinding.DataSource = PersonANCServiceDS
            Properties.View = cavClassic
            TabOrder = 3
            Width = 166
          end
          object cxDBTimeEdit1: TcxDBTimeEdit
            Left = 341
            Top = 35
            DataBinding.DataField = 'anc_service_time'
            DataBinding.DataSource = PersonANCServiceDS
            TabOrder = 4
            Width = 121
          end
        end
        object dxLayoutControl2Group_Root: TdxLayoutGroup
          AlignHorz = ahClient
          AlignVert = avTop
          ButtonOptions.Buttons = <>
          Hidden = True
          ShowBorder = False
          Index = -1
        end
        object dxLayoutControl2Item1: TdxLayoutItem
          Parent = dxLayoutControl2Group_Root
          CaptionOptions.Text = 'cxGroupBox5'
          CaptionOptions.Visible = False
          Control = PatientInformationDetailGroupBox
          ControlOptions.AutoColor = True
          ControlOptions.OriginalHeight = 142
          ControlOptions.OriginalWidth = 755
          ControlOptions.ShowBorder = False
          Index = 0
        end
        object dxLayoutControl2Item3: TdxLayoutItem
          Parent = dxLayoutControl2Group_Root
          CaptionOptions.Visible = False
          Control = VisitGroupBox
          ControlOptions.AutoColor = True
          ControlOptions.OriginalHeight = 246
          ControlOptions.OriginalWidth = 765
          ControlOptions.ShowBorder = False
          Index = 1
        end
        object dxLayoutControl2Item2: TdxLayoutItem
          Parent = dxLayoutControl2Group_Root
          CaptionOptions.Visible = False
          Control = cxGroupBox4
          ControlOptions.AutoColor = True
          ControlOptions.OriginalHeight = 146
          ControlOptions.OriginalWidth = 765
          ControlOptions.ShowBorder = False
          Index = 2
        end
      end
    end
    object ScreenTabSheet: TcxTabSheet
      Caption = #3585#3634#3619#3588#3633#3604#3585#3619#3629#3591
      ImageIndex = 0
    end
    object Petabsheet: TcxTabSheet
      Caption = #3585#3634#3619#3605#3619#3623#3592#3619#3656#3634#3591#3585#3634#3618
      ImageIndex = 8
      OnShow = PetabsheetShow
    end
    object cxTabSheet2: TcxTabSheet
      Caption = #3605#3619#3623#3592#3588#3619#3619#3616#3660
      ImageIndex = 1
      object dxLayoutControl1: TdxLayoutControl
        Left = 0
        Top = 0
        Width = 761
        Height = 697
        Align = alClient
        TabOrder = 0
        LayoutLookAndFeel = dxLayoutSkinLookAndFeel1
        object cxGroupBox1: TcxGroupBox
          Left = 5
          Top = 136
          Caption = #3585#3634#3619#3588#3633#3604#3585#3619#3629#3591
          TabOrder = 1
          Height = 71
          Width = 751
          object Label2: TLabel
            Left = 372
            Top = 34
            Width = 64
            Height = 16
            Caption = 'Vallop BMI.'
          end
          object Label3: TLabel
            Left = 11
            Top = 34
            Width = 46
            Height = 16
            Caption = 'Albumin'
          end
          object Label4: TLabel
            Left = 526
            Top = 34
            Width = 34
            Height = 16
            Caption = 'Sugar'
          end
          object Label5: TLabel
            Left = 189
            Top = 34
            Width = 60
            Height = 16
            Caption = #3619#3632#3604#3633#3610#3617#3604#3621#3641#3585
          end
          object cxDBTextEdit2: TcxDBTextEdit
            Left = 446
            Top = 31
            DataBinding.DataField = 'bmi'
            DataBinding.DataSource = PersonANCScreenDS
            TabOrder = 2
            Width = 65
          end
          object cxDBTextEdit3: TcxDBComboBox
            Left = 71
            Top = 31
            DataBinding.DataField = 'albumin'
            DataBinding.DataSource = PersonANCScreenDS
            Properties.IncrementalFiltering = True
            Properties.Items.Strings = (
              #3611#3585#3605#3636
              '+1'
              '+2'
              '+3'
              '+4'
              'Trace')
            TabOrder = 0
            Width = 106
          end
          object cxDBTextEdit4: TcxDBComboBox
            Left = 575
            Top = 31
            DataBinding.DataField = 'sugar'
            DataBinding.DataSource = PersonANCScreenDS
            Properties.IncrementalFiltering = True
            Properties.Items.Strings = (
              #3611#3585#3605#3636
              '+1'
              '+2'
              '+3'
              'Trace')
            TabOrder = 3
            Width = 109
          end
          object cxDBLookupComboBox1: TcxDBLookupComboBox
            Left = 254
            Top = 31
            DataBinding.DataField = 'anc_uterus_level_id'
            DataBinding.DataSource = PersonANCScreenDS
            Properties.IncrementalFilteringOptions = [ifoHighlightSearchText, ifoUseContainsOperator]
            Properties.KeyFieldNames = 'anc_uterus_level_id'
            Properties.ListColumns = <
              item
                FieldName = 'anc_uterus_level_name'
              end>
            Properties.ListSource = HOSxPPCUAccount2DataModule.ANCUterusLevelDS
            TabOrder = 1
            Width = 110
          end
        end
        object cxGroupBox2: TcxGroupBox
          Left = 5
          Top = 214
          Caption = #3629#3634#3585#3634#3619#3626#3635#3588#3633#3597
          TabOrder = 2
          Height = 180
          Width = 751
          object cxDBCheckBox1: TcxCheckBox
            Left = 12
            Top = 30
            Caption = #3611#3623#3604#3624#3619#3637#3625#3632
            TabOrder = 0
            Transparent = True
          end
          object cxDBCheckBox2: TcxCheckBox
            Left = 12
            Top = 56
            Caption = #3588#3621#3639#3656#3609#3652#3626#3657
            TabOrder = 2
            Transparent = True
          end
          object cxDBCheckBox3: TcxCheckBox
            Left = 12
            Top = 82
            Caption = #3605#3656#3629#3617#3652#3607#3619#3629#3618#3604#3660#3650#3605
            TabOrder = 4
            Transparent = True
          end
          object cxDBCheckBox4: TcxCheckBox
            Left = 12
            Top = 108
            Caption = #3648#3604#3655#3585#3604#3636#3657#3609
            TabOrder = 6
            Transparent = True
          end
          object cxDBCheckBox5: TcxCheckBox
            Left = 12
            Top = 134
            Caption = #3605#3585#3586#3634#3623
            TabOrder = 8
            Transparent = True
          end
          object cxDBCheckBox6: TcxCheckBox
            Left = 159
            Top = 30
            Caption = #3610#3623#3617
            TabOrder = 1
            Transparent = True
          end
          object cxDBCheckBox7: TcxCheckBox
            Left = 159
            Top = 56
            Caption = #3648#3621#3639#3629#3604#3629#3629#3585#3607#3634#3591#3594#3656#3629#3591#3588#3621#3629#3604
            TabOrder = 3
            Transparent = True
          end
          object cxDBCheckBox8: TcxCheckBox
            Left = 159
            Top = 82
            Caption = #3605#3632#3588#3619#3636#3623
            TabOrder = 5
            Transparent = True
          end
          object cxDBCheckBox9: TcxCheckBox
            Left = 159
            Top = 108
            Caption = #3619#3632#3610#3610#3607#3634#3591#3648#3604#3636#3609#3611#3633#3626#3626#3634#3623#3632
            TabOrder = 7
            Transparent = True
          end
          object cxDBCheckBox10: TcxCheckBox
            Left = 159
            Top = 134
            Caption = #3650#3619#3588#3627#3633#3623#3651#3592
            TabOrder = 9
            Transparent = True
          end
        end
        object cxGroupBox8: TcxGroupBox
          Left = 5
          Top = 401
          Caption = #3588#3633#3604#3585#3619#3629#3591#3607#3633#3609#3605#3585#3619#3619#3617
          TabOrder = 3
          Height = 117
          Width = 751
          object Label21: TLabel
            Left = 122
            Top = 51
            Width = 9
            Height = 16
            Caption = #3595#3637#3656
          end
          object cxDBCheckBox11: TcxDBCheckBox
            Left = 4
            Top = 24
            Caption = #3652#3604#3657#3619#3633#3610#3585#3634#3619#3605#3619#3623#3592#3615#3633#3609
            DataBinding.DataField = 'dt_screen1'
            DataBinding.DataSource = PersonANCScreenDS
            Properties.NullStyle = nssUnchecked
            Properties.ValueChecked = 'Y'
            Properties.ValueUnchecked = 'N'
            TabOrder = 0
            Transparent = True
          end
          object cxDBCheckBox12: TcxDBCheckBox
            Left = 4
            Top = 50
            Caption = #3617#3637#3612#3640
            DataBinding.DataField = 'dt_screen2'
            DataBinding.DataSource = PersonANCScreenDS
            Properties.NullStyle = nssUnchecked
            Properties.ValueChecked = 'Y'
            Properties.ValueUnchecked = 'N'
            TabOrder = 1
            Transparent = True
          end
          object cxDBCheckBox13: TcxDBCheckBox
            Left = 187
            Top = 20
            Caption = #3617#3637#3648#3627#3591#3639#3629#3585#3629#3633#3585#3648#3626#3610
            DataBinding.DataField = 'dt_screen3'
            DataBinding.DataSource = PersonANCScreenDS
            Properties.NullStyle = nssUnchecked
            Properties.ValueChecked = 'Y'
            Properties.ValueUnchecked = 'N'
            TabOrder = 3
            Transparent = True
          end
          object cxDBCheckBox14: TcxDBCheckBox
            Left = 187
            Top = 45
            Caption = #3617#3637#3627#3636#3609#3609#3657#3635#3621#3634#3618
            DataBinding.DataField = 'dt_screen4'
            DataBinding.DataSource = PersonANCScreenDS
            Properties.NullStyle = nssUnchecked
            Properties.ValueChecked = 'Y'
            Properties.ValueUnchecked = 'N'
            TabOrder = 4
            Transparent = True
          end
          object cxDBCheckBox15: TcxDBCheckBox
            Left = 187
            Top = 71
            Caption = #3652#3604#3657#3619#3633#3610#3610#3619#3636#3585#3634#3619#3607#3633#3609#3605#3585#3619#3619#3617
            DataBinding.DataField = 'dt_screen5'
            DataBinding.DataSource = PersonANCScreenDS
            Properties.NullStyle = nssUnchecked
            Properties.ValueChecked = 'Y'
            Properties.ValueUnchecked = 'N'
            TabOrder = 5
            Transparent = True
          end
          object cxDBSpinEdit2: TcxDBSpinEdit
            Left = 53
            Top = 50
            DataBinding.DataField = 'dt_decay_count'
            DataBinding.DataSource = PersonANCScreenDS
            TabOrder = 2
            Width = 55
          end
        end
        object cxGroupBox3: TcxGroupBox
          Left = 5
          Top = 5
          Caption = #3585#3634#3619#3605#3619#3623#3592#3588#3619#3619#3616#3660
          TabOrder = 0
          DesignSize = (
            751
            124)
          Height = 124
          Width = 751
          object Label6: TLabel
            Left = 43
            Top = 61
            Width = 35
            Height = 16
            Caption = #3607#3656#3634#3648#3604#3655#3585
          end
          object Label7: TLabel
            Left = 7
            Top = 90
            Width = 73
            Height = 16
            Caption = #3648#3626#3637#3618#3591#3627#3633#3623#3651#3592#3648#3604#3655#3585
          end
          object Label8: TLabel
            Left = 29
            Top = 32
            Width = 50
            Height = 16
            Caption = #3629#3634#3618#3640#3588#3619#3619#3616#3660
          end
          object Label9: TLabel
            Left = 151
            Top = 32
            Width = 38
            Height = 16
            Caption = #3626#3633#3611#3604#3634#3627#3660
          end
          object Label11: TLabel
            Left = 214
            Top = 61
            Width = 75
            Height = 16
            Caption = #3626#3656#3623#3609#3609#3635'/'#3585#3634#3619#3621#3591
          end
          object Label1: TLabel
            Left = 257
            Top = 32
            Width = 14
            Height = 16
            Caption = #3623#3633#3609
          end
          object cxDBLookupComboBox2: TcxDBLookupComboBox
            Left = 84
            Top = 58
            DataBinding.DataField = 'anc_baby_position_id'
            DataBinding.DataSource = PersonANCScreenDS
            Properties.IncrementalFilteringOptions = [ifoHighlightSearchText, ifoUseContainsOperator]
            Properties.KeyFieldNames = 'anc_baby_position_id'
            Properties.ListColumns = <
              item
                FieldName = 'anc_baby_position_name'
              end>
            Properties.ListSource = HOSxPPCUAccount2DataModule.ANCBabyPositionDS
            TabOrder = 1
            Width = 121
          end
          object cxDBTextEdit5: TcxDBTextEdit
            Left = 84
            Top = 87
            DataBinding.DataField = 'baby_fetal_heart_text'
            DataBinding.DataSource = PersonANCScreenDS
            TabOrder = 3
            Width = 121
          end
          object cxDBSpinEdit1: TcxDBSpinEdit
            Left = 84
            Top = 30
            DataBinding.DataField = 'pa_week'
            DataBinding.DataSource = PersonANCServiceDS
            Properties.Alignment.Horz = taCenter
            TabOrder = 0
            Width = 61
          end
          object cxDBLookupComboBox3: TcxDBLookupComboBox
            Left = 295
            Top = 58
            DataBinding.DataField = 'anc_baby_lead_id'
            DataBinding.DataSource = PersonANCScreenDS
            Properties.IncrementalFilteringOptions = [ifoHighlightSearchText, ifoUseContainsOperator]
            Properties.KeyFieldNames = 'anc_baby_lead_id'
            Properties.ListColumns = <
              item
                FieldName = 'anc_baby_lead_name'
              end>
            Properties.ListSource = HOSxPPCUAccount2DataModule.ANCBabyLeadDS
            TabOrder = 2
            Width = 202
          end
          object cxDBCheckBox16: TcxDBCheckBox
            Left = 413
            Top = 88
            Caption = #3612#3621#3585#3634#3619#3605#3619#3623#3592#3612#3636#3604#3611#3585#3605#3636
            DataBinding.DataField = 'service_result'
            DataBinding.DataSource = PersonANCServiceDS
            Properties.NullStyle = nssUnchecked
            Properties.ValueChecked = 'N'
            Properties.ValueUnchecked = 'Y'
            TabOrder = 4
            Transparent = True
          end
          object cxDBCheckBox17: TcxDBCheckBox
            Left = 305
            Top = 28
            Caption = #3609#3633#3610#3648#3611#3655#3609#3612#3621#3591#3634#3609#3586#3629#3591#3607#3637#3656#3609#3637#3656
            DataBinding.DataField = 'real_anc_service'
            DataBinding.DataSource = PersonANCServiceDS
            Properties.NullStyle = nssUnchecked
            Properties.ValueChecked = 'Y'
            Properties.ValueUnchecked = 'N'
            TabOrder = 5
            Transparent = True
          end
          object cxDBCheckBox18: TcxDBCheckBox
            Left = 439
            Top = 28
            Caption = #3648#3611#3655#3609#3585#3634#3619#3605#3619#3623#3592#3648#3618#3637#3656#3618#3617#3607#3637#3656#3610#3657#3634#3609
            DataBinding.DataField = 'home_visit'
            DataBinding.DataSource = PersonANCServiceDS
            Properties.NullStyle = nssUnchecked
            Properties.ValueChecked = 'Y'
            Properties.ValueUnchecked = 'N'
            TabOrder = 6
            Transparent = True
          end
          object ShowAllButton: TcxButton
            Left = 667
            Top = 15
            Width = 75
            Height = 25
            Anchors = [akTop, akRight]
            Caption = 'Show all'
            TabOrder = 7
            Visible = False
            OnClick = ShowAllButtonClick
          end
          object cxDBCheckBox19: TcxDBCheckBox
            Left = 238
            Top = 89
            Caption = #3652#3604#3657#3619#3633#3610#3585#3634#3619#3605#3619#3623#3592' Ultrasound'
            DataBinding.DataField = 'ultrasound_flag'
            DataBinding.DataSource = PersonANCServiceDS
            Properties.NullStyle = nssUnchecked
            Properties.ValueChecked = 'Y'
            Properties.ValueUnchecked = 'N'
            Style.TransparentBorder = False
            TabOrder = 8
            Transparent = True
          end
          object cxDBSpinEdit3: TcxDBSpinEdit
            Left = 190
            Top = 30
            DataBinding.DataField = 'pa_day'
            DataBinding.DataSource = PersonANCServiceDS
            Properties.Alignment.Horz = taCenter
            TabOrder = 9
            Width = 61
          end
        end
        object cxGroupBox5: TcxGroupBox
          Left = 5
          Top = 525
          Caption = #3610#3633#3609#3607#3638#3585#3585#3634#3619#3605#3619#3623#3592
          TabOrder = 4
          Height = 161
          Width = 751
          object cxDBMemo1: TcxDBMemo
            Left = 2
            Top = 21
            Align = alClient
            DataBinding.DataField = 'service_note_text'
            DataBinding.DataSource = PersonANCServiceDS
            Properties.ScrollBars = ssVertical
            TabOrder = 0
            Height = 138
            Width = 747
          end
        end
        object dxLayoutControl1Group_Root: TdxLayoutGroup
          AlignHorz = ahClient
          AlignVert = avTop
          ButtonOptions.Buttons = <>
          Hidden = True
          ShowBorder = False
          Index = -1
        end
        object dxLayoutControl1Item1: TdxLayoutItem
          Parent = dxLayoutControl1Group_Root
          AlignHorz = ahClient
          CaptionOptions.Visible = False
          Control = cxGroupBox1
          ControlOptions.AutoColor = True
          ControlOptions.OriginalHeight = 71
          ControlOptions.OriginalWidth = 757
          ControlOptions.ShowBorder = False
          Index = 1
        end
        object dxLayoutControl1Item3: TdxLayoutItem
          Parent = dxLayoutControl1Group_Root
          CaptionOptions.Visible = False
          Control = cxGroupBox2
          ControlOptions.AutoColor = True
          ControlOptions.OriginalHeight = 180
          ControlOptions.OriginalWidth = 765
          ControlOptions.ShowBorder = False
          Index = 2
        end
        object dxLayoutControl1Item4: TdxLayoutItem
          Parent = dxLayoutControl1Group_Root
          CaptionOptions.Visible = False
          Control = cxGroupBox8
          ControlOptions.AutoColor = True
          ControlOptions.OriginalHeight = 117
          ControlOptions.OriginalWidth = 765
          ControlOptions.ShowBorder = False
          Index = 3
        end
        object dxLayoutControl1Item2: TdxLayoutItem
          Parent = dxLayoutControl1Group_Root
          CaptionOptions.Visible = False
          Control = cxGroupBox3
          ControlOptions.AutoColor = True
          ControlOptions.OriginalHeight = 124
          ControlOptions.OriginalWidth = 765
          ControlOptions.ShowBorder = False
          Index = 0
        end
        object dxLayoutItem1: TdxLayoutItem
          Parent = dxLayoutControl1Group_Root
          CaptionOptions.Text = 'cxGroupBox5'
          CaptionOptions.Visible = False
          Control = cxGroupBox5
          ControlOptions.AutoColor = True
          ControlOptions.OriginalHeight = 161
          ControlOptions.OriginalWidth = 755
          ControlOptions.ShowBorder = False
          Index = 4
        end
      end
    end
    object cxTabSheet1: TcxTabSheet
      Caption = #3585#3634#3619#3623#3636#3609#3636#3592#3593#3633#3618
      ImageIndex = 3
      object DxGroupBox: TcxGroupBox
        Left = 0
        Top = 0
        Align = alClient
        Caption = #3585#3634#3619#3623#3636#3609#3636#3592#3593#3633#3618
        TabOrder = 0
        Height = 697
        Width = 761
      end
    end
    object cxTabSheet3: TcxTabSheet
      Caption = #3585#3634#3619#3626#3633#3656#3591#3618#3634
      ImageIndex = 4
      object MedicationGroupBox: TcxGroupBox
        Left = 0
        Top = 0
        Align = alClient
        Caption = #3585#3634#3619#3626#3633#3656#3591#3618#3634
        TabOrder = 0
        Height = 697
        Width = 761
      end
    end
    object cxTabSheet4: TcxTabSheet
      Caption = #3585#3634#3619#3626#3633#3656#3591' Lab'
      ImageIndex = 5
      OnShow = cxTabSheet4Show
      object LabGroupBox: TcxGroupBox
        Left = 0
        Top = 0
        Align = alClient
        Caption = #3585#3634#3619#3626#3633#3656#3591' Lab'
        TabOrder = 0
        Height = 697
        Width = 761
      end
    end
    object cxTabSheet5: TcxTabSheet
      Caption = #3585#3634#3619#3626#3633#3656#3591' X-Ray'
      ImageIndex = 6
      object cxButton1: TcxButton
        Left = 8
        Top = 8
        Width = 75
        Height = 25
        Caption = #3626#3633#3656#3591' X-Ray'
        TabOrder = 0
        OnClick = cxButton1Click
      end
    end
    object AppointmentTabSheet: TcxTabSheet
      Caption = #3585#3634#3619#3609#3633#3604#3627#3617#3634#3618
      ImageIndex = 7
      OnShow = AppointmentTabSheetShow
    end
    object VaccineTabSheet: TcxTabSheet
      Caption = 'Vaccine'
      ImageIndex = 9
      OnShow = VaccineTabSheetShow
    end
    object DentalCareTabSheet: TcxTabSheet
      Caption = #3605#3619#3623#3592#3615#3633#3609
      ImageIndex = 10
      OnShow = DentalCareTabSheetShow
    end
    object ANCLabTabSheet: TcxTabSheet
      Caption = #3612#3621#3585#3634#3619#3605#3619#3623#3592' Lab'
      ImageIndex = 11
      OnShow = ANCLabTabSheetShow
    end
  end
  object PersonANCServiceCDS: TClientDataSet
    Active = True
    Aggregates = <>
    CommandText = 'select * from person_anc_service  limit 0'#13#10
    Params = <>
    BeforePost = PersonANCServiceCDSBeforePost
    OnNewRecord = PersonANCServiceCDSNewRecord
    Left = 652
    Top = 45
    Data = {
      770700009619E0BD010000001800000017000000000003000000770715706572
      736F6E5F616E635F736572766963655F69640400010000000100064F52494749
      4E020049802900706572736F6E5F616E635F736572766963652E706572736F6E
      5F616E635F736572766963655F6964000D706572736F6E5F616E635F69640400
      010000000100064F524947494E020049802100706572736F6E5F616E635F7365
      72766963652E706572736F6E5F616E635F69640010616E635F73657276696365
      5F646174650400060000000100064F524947494E020049802400706572736F6E
      5F616E635F736572766963652E616E635F736572766963655F64617465001061
      6E635F736572766963655F6E6F74650100490000000200055749445448020002
      00FA00064F524947494E020049802400706572736F6E5F616E635F7365727669
      63652E616E635F736572766963655F6E6F7465000770615F7765656B04000100
      00000100064F524947494E020049801B00706572736F6E5F616E635F73657276
      6963652E70615F7765656B000E736572766963655F726573756C740100490000
      0003000753554254595045020049000A00466978656443686172000557494454
      48020002000100064F524947494E020049802200706572736F6E5F616E635F73
      6572766963652E736572766963655F726573756C74000D70726F76696465725F
      747970650400010000000100064F524947494E020049802100706572736F6E5F
      616E635F736572766963652E70726F76696465725F747970650002766E010049
      0000000200055749445448020002000D00064F524947494E0200498016007065
      72736F6E5F616E635F736572766963652E766E001170726F76696465725F686F
      7370636F646501004900000003000753554254595045020049000A0046697865
      644368617200055749445448020002000500064F524947494E02004980250070
      6572736F6E5F616E635F736572766963652E70726F76696465725F686F737063
      6F6465000B6F6C645F76697369746E6F0400010000000100064F524947494E02
      0049801F00706572736F6E5F616E635F736572766963652E6F6C645F76697369
      746E6F0013616E635F736572766963655F747970655F69640400010000000100
      064F524947494E020049802700706572736F6E5F616E635F736572766963652E
      616E635F736572766963655F747970655F69640012616E635F73657276696365
      5F6E756D6265720400010000000100064F524947494E02004980260070657273
      6F6E5F616E635F736572766963652E616E635F736572766963655F6E756D6265
      72000C736572766963655F746578740100490000000200055749445448020002
      00FA00064F524947494E020049802000706572736F6E5F616E635F7365727669
      63652E736572766963655F746578740008686F735F6775696401004900000002
      00055749445448020002002600064F524947494E020049801C00706572736F6E
      5F616E635F736572766963652E686F735F677569640010616E635F7365727669
      63655F74696D650400070000000100064F524947494E02004980240070657273
      6F6E5F616E635F736572766963652E616E635F736572766963655F74696D6500
      14616E635F6C6F636174696F6E5F747970655F69640400010000000100064F52
      4947494E020049802800706572736F6E5F616E635F736572766963652E616E63
      5F6C6F636174696F6E5F747970655F6964000D6F6C645F7669736974636F6465
      0100490000000200055749445448020002001900064F524947494E0200498021
      00706572736F6E5F616E635F736572766963652E6F6C645F7669736974636F64
      6500107265616C5F616E635F7365727669636501004900000003000753554254
      595045020049000A004669786564436861720005574944544802000200010006
      4F524947494E020049802400706572736F6E5F616E635F736572766963652E72
      65616C5F616E635F73657276696365000A686F6D655F76697369740100490000
      0003000753554254595045020049000A00466978656443686172000557494454
      48020002000100064F524947494E020049801E00706572736F6E5F616E635F73
      6572766963652E686F6D655F7669736974000C706173735F7175616C69747901
      004900000003000753554254595045020049000A004669786564436861720005
      5749445448020002000100064F524947494E020049802000706572736F6E5F61
      6E635F736572766963652E706173735F7175616C697479001173657276696365
      5F6E6F74655F7465787404004B00000002000753554254595045020049000500
      5465787400064F524947494E020049802500706572736F6E5F616E635F736572
      766963652E736572766963655F6E6F74655F74657874000F756C747261736F75
      6E645F666C616701004900000003000753554254595045020049000A00466978
      65644368617200055749445448020002000100064F524947494E020049802300
      706572736F6E5F616E635F736572766963652E756C747261736F756E645F666C
      6167000670615F6461790400010000000100064F524947494E020049801A0070
      6572736F6E5F616E635F736572766963652E70615F646179000000}
  end
  object PersonANCServiceDS: TDataSource
    DataSet = PersonANCServiceCDS
    Left = 726
    Top = 48
  end
  object PersonANCScreenCDS: TClientDataSet
    Active = True
    Aggregates = <>
    CommandText = 'select * from person_anc_screen limit 0'#13#10
    Params = <>
    BeforePost = PersonANCScreenCDSBeforePost
    Left = 417
    Top = 227
    Data = {
      850600009619E0BD010000001800000016000000000003000000850614706572
      736F6E5F616E635F73637265656E5F69640400010000000100064F524947494E
      020049802700706572736F6E5F616E635F73637265656E2E706572736F6E5F61
      6E635F73637265656E5F69640015706572736F6E5F616E635F73657276696365
      5F69640400010000000100064F524947494E020049802800706572736F6E5F61
      6E635F73637265656E2E706572736F6E5F616E635F736572766963655F696400
      0262770800040000000100064F524947494E020049801500706572736F6E5F61
      6E635F73637265656E2E627700066865696768740800040000000100064F5249
      47494E020049801900706572736F6E5F616E635F73637265656E2E6865696768
      740007616C62756D696E0100490000000200055749445448020002001900064F
      524947494E020049801A00706572736F6E5F616E635F73637265656E2E616C62
      756D696E0003626D690800040000000100064F524947494E0200498016007065
      72736F6E5F616E635F73637265656E2E626D6900057375676172010049000000
      0200055749445448020002001900064F524947494E020049801800706572736F
      6E5F616E635F73637265656E2E73756761720013616E635F7574657275735F6C
      6576656C5F69640400010000000100064F524947494E02004980260070657273
      6F6E5F616E635F73637265656E2E616E635F7574657275735F6C6576656C5F69
      64000763635F7465787404004B00000002000753554254595045020049000500
      5465787400064F524947494E020049801A00706572736F6E5F616E635F736372
      65656E2E63635F746578740014616E635F626162795F706F736974696F6E5F69
      640400010000000100064F524947494E020049802700706572736F6E5F616E63
      5F73637265656E2E616E635F626162795F706F736974696F6E5F69640010616E
      635F626162795F6C6561645F69640400010000000100064F524947494E020049
      802300706572736F6E5F616E635F73637265656E2E616E635F626162795F6C65
      61645F69640016626162795F666574616C5F68656172745F736F756E64040001
      0000000100064F524947494E020049802900706572736F6E5F616E635F736372
      65656E2E626162795F666574616C5F68656172745F736F756E640008686F735F
      677569640100490000000200055749445448020002002600064F524947494E02
      0049801B00706572736F6E5F616E635F73637265656E2E686F735F6775696400
      0A64745F73637265656E3101004900000003000753554254595045020049000A
      0046697865644368617200055749445448020002000100064F524947494E0200
      49801D00706572736F6E5F616E635F73637265656E2E64745F73637265656E31
      000A64745F73637265656E320100490000000300075355425459504502004900
      0A0046697865644368617200055749445448020002000100064F524947494E02
      0049801D00706572736F6E5F616E635F73637265656E2E64745F73637265656E
      32000A64745F73637265656E3301004900000003000753554254595045020049
      000A0046697865644368617200055749445448020002000100064F524947494E
      020049801D00706572736F6E5F616E635F73637265656E2E64745F7363726565
      6E33000A64745F73637265656E34010049000000030007535542545950450200
      49000A0046697865644368617200055749445448020002000100064F52494749
      4E020049801D00706572736F6E5F616E635F73637265656E2E64745F73637265
      656E34000A64745F73637265656E350100490000000300075355425459504502
      0049000A0046697865644368617200055749445448020002000100064F524947
      494E020049801D00706572736F6E5F616E635F73637265656E2E64745F736372
      65656E35000E64745F64656361795F636F756E740400010000000100064F5249
      47494E020049802100706572736F6E5F616E635F73637265656E2E64745F6465
      6361795F636F756E7400036270730400010000000100064F524947494E020049
      801600706572736F6E5F616E635F73637265656E2E6270730003627064040001
      0000000100064F524947494E020049801600706572736F6E5F616E635F736372
      65656E2E6270640015626162795F666574616C5F68656172745F746578740100
      49000000020005574944544802000200C800064F524947494E02004980280070
      6572736F6E5F616E635F73637265656E2E626162795F666574616C5F68656172
      745F74657874000000}
  end
  object PersonANCScreenDS: TDataSource
    DataSet = PersonANCScreenCDS
    Left = 506
    Top = 231
  end
  object PersonANCCDS: TClientDataSet
    Aggregates = <>
    Params = <>
    Left = 419
    Top = 300
  end
  object PersonANCDS: TDataSource
    DataSet = PersonANCCDS
    Left = 495
    Top = 289
  end
  object dxLayoutLookAndFeelList1: TdxLayoutLookAndFeelList
    Left = 44
    Top = 277
    object dxLayoutSkinLookAndFeel1: TdxLayoutSkinLookAndFeel
      Offsets.RootItemsAreaOffsetHorz = 3
      Offsets.RootItemsAreaOffsetVert = 3
      PixelsPerInch = 96
    end
  end
  object PersonANCLabCDS: TClientDataSet
    Aggregates = <>
    Params = <>
    BeforePost = PersonANCLabCDSBeforePost
    Left = 205
    Top = 603
  end
end
