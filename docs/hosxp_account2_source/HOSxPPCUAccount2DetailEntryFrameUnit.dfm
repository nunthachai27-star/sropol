object HOSxPPCUAccount2DetailEntryFrame: THOSxPPCUAccount2DetailEntryFrame
  Left = 0
  Top = 0
  Width = 859
  Height = 557
  Font.Charset = DEFAULT_CHARSET
  Font.Color = clWindowText
  Font.Height = -13
  Font.Name = 'Tahoma'
  Font.Style = []
  ParentFont = False
  TabOrder = 0
  object dxLayoutControl1: TdxLayoutControl
    Left = 0
    Top = 0
    Width = 859
    Height = 557
    Align = alClient
    TabOrder = 0
    LayoutLookAndFeel = dxLayoutSkinLookAndFeel1
    object cxGroupBox1: TcxGroupBox
      Left = 5
      Top = 5
      Caption = #3586#3657#3629#3617#3641#3621#3585#3634#3619#3613#3634#3585#3588#3619#3619#3616#3660
      ParentBackground = False
      ParentColor = False
      Style.Color = 16053234
      TabOrder = 0
      Height = 117
      Width = 849
      object Label12: TcxLabel
        Left = 5
        Top = 24
        Caption = #3623#3633#3609#3607#3637#3656#3621#3591#3607#3632#3648#3610#3637#3618#3609#3613#3634#3585#3588#3619#3619#3616#3660
        Transparent = True
      end
      object Label13: TcxLabel
        Left = 277
        Top = 24
        Caption = #3612#3641#3657#3619#3633#3610#3613#3634#3585#3588#3619#3619#3616#3660
        Transparent = True
      end
      object Label14: TcxLabel
        Left = 536
        Top = 24
        Caption = #3648#3621#3586#3607#3637#3656#3613#3634#3585#3588#3619#3619#3616#3660
        Transparent = True
      end
      object Label20: TcxLabel
        Left = 752
        Top = 24
        Caption = #3588#3619#3619#3616#3660#3607#3637#3656
        Transparent = True
      end
      object Label29: TcxLabel
        Left = 59
        Top = 53
        Caption = #3626#3606#3634#3609#3632#3611#3633#3592#3592#3640#3610#3633#3609
        Transparent = True
      end
      object Label25: TcxLabel
        Left = 311
        Top = 53
        Caption = 'LMP'
        Transparent = True
      end
      object Label22: TcxLabel
        Left = 524
        Top = 52
        Caption = 'EDC'
        Transparent = True
      end
      object Label46: TcxLabel
        Left = 36
        Top = 80
        Caption = #3614#3610#3649#3614#3607#3618#3660#3588#3619#3633#3657#3591#3649#3619#3585
        Transparent = True
      end
      object Label28: TcxLabel
        Left = 284
        Top = 80
        Caption = #3623#3633#3609#3607#3637#3656#3592#3635#3627#3609#3656#3634#3618
        Transparent = True
      end
      object cxDBDateEdit1: TcxDBDateEdit
        Left = 141
        Top = 23
        DataBinding.DataField = 'anc_register_date'
        DataBinding.DataSource = PersonANCDS
        Properties.View = cavClassic
        TabOrder = 0
        Width = 133
      end
      object cxDBComboBox1: TcxDBComboBox
        Left = 352
        Top = 23
        DataBinding.DataField = 'anc_register_staff'
        DataBinding.DataSource = PersonANCDS
        Properties.IncrementalFiltering = True
        TabOrder = 1
        Width = 121
      end
      object cxDBTextEdit14: TcxDBTextEdit
        Left = 618
        Top = 23
        DataBinding.DataField = 'person_anc_no'
        DataBinding.DataSource = PersonANCDS
        Properties.Alignment.Horz = taCenter
        TabOrder = 2
        Width = 67
      end
      object cxButton6: TcxButton
        Left = 691
        Top = 23
        Width = 58
        Height = 22
        Caption = #3629#3629#3585#3651#3627#3617#3656
        TabOrder = 3
        OnClick = cxButton6Click
      end
      object cxDBTextEdit15: TcxDBSpinEdit
        Left = 793
        Top = 23
        DataBinding.DataField = 'preg_no'
        DataBinding.DataSource = PersonANCDS
        ParentFont = False
        Properties.Alignment.Horz = taCenter
        Properties.MaxValue = 20.000000000000000000
        Properties.MinValue = 1.000000000000000000
        Properties.OnEditValueChanged = cxDBTextEdit15PropertiesEditValueChanged
        Style.Color = 12171775
        Style.Font.Charset = DEFAULT_CHARSET
        Style.Font.Color = clWindowText
        Style.Font.Height = -13
        Style.Font.Name = 'MS Sans Serif'
        Style.Font.Style = [fsBold]
        Style.IsFontAssigned = True
        TabOrder = 4
        Width = 43
      end
      object cxDBLookupComboBox5: TcxDBLookupComboBox
        Left = 141
        Top = 51
        DataBinding.DataField = 'labor_status_id'
        DataBinding.DataSource = PersonANCDS
        Properties.IncrementalFilteringOptions = [ifoHighlightSearchText, ifoUseContainsOperator]
        Properties.KeyFieldNames = 'labor_status_id'
        Properties.ListColumns = <
          item
            FieldName = 'labor_status_name'
          end>
        Properties.ListSource = HOSxPPCUAccount2DataModule.LaborStatusDS
        TabOrder = 5
        Width = 133
      end
      object cxDBDateEdit4: TcxDBDateEdit
        Left = 352
        Top = 51
        DataBinding.DataField = 'lmp'
        DataBinding.DataSource = PersonANCDS
        Properties.View = cavClassic
        Properties.OnCloseUp = cxDBDateEdit4PropertiesCloseUp
        TabOrder = 6
        Width = 121
      end
      object cxButton10: TcxButton
        Left = 475
        Top = 51
        Width = 40
        Height = 24
        Caption = 'Calc.'
        TabOrder = 7
        OnClick = cxButton10Click
      end
      object cxDBDateEdit3: TcxDBDateEdit
        Left = 564
        Top = 51
        DataBinding.DataField = 'edc'
        DataBinding.DataSource = PersonANCDS
        Properties.View = cavClassic
        TabOrder = 8
        Width = 121
      end
      object cxDBDateEdit11: TcxDBDateEdit
        Left = 141
        Top = 79
        DataBinding.DataField = 'first_doctor_date'
        DataBinding.DataSource = PersonANCDS
        Properties.View = cavClassic
        TabOrder = 9
        Width = 133
      end
      object cxDBDateEdit5: TcxDBDateEdit
        Left = 352
        Top = 79
        DataBinding.DataField = 'discharge_date'
        DataBinding.DataSource = PersonANCDS
        Properties.View = cavClassic
        TabOrder = 10
        Width = 121
      end
      object cxDBCheckBox5: TcxDBCheckBox
        Left = 564
        Top = 81
        Caption = 'EDC '#3592#3634#3585' U/S'
        DataBinding.DataField = 'lmp_from_us'
        DataBinding.DataSource = PersonANCDS
        Properties.NullStyle = nssUnchecked
        Properties.ValueChecked = 'Y'
        Properties.ValueUnchecked = 'N'
        TabOrder = 11
        Transparent = True
      end
      object cxDBCheckBox1: TcxDBCheckBox
        Left = 689
        Top = 81
        Caption = #3652#3604#3657#3619#3633#3610' TT '#3588#3619#3610#3594#3640#3604#3649#3621#3657#3623
        DataBinding.DataField = 'vaccine_tt_complete'
        DataBinding.DataSource = PersonANCDS
        Properties.NullStyle = nssUnchecked
        Properties.ValueChecked = 'Y'
        Properties.ValueUnchecked = 'N'
        TabOrder = 12
        Transparent = True
      end
      object cxButton1: TcxButton
        Left = 475
        Top = 23
        Width = 49
        Height = 24
        Caption = #3588#3657#3609
        OptionsImage.Glyph.SourceDPI = 96
        OptionsImage.Glyph.Data = {
          424D360400000000000036000000280000001000000010000000010020000000
          000000000000C40E0000C40E00000000000000000000000000000101053A0203
          2DA803043CB904053DB804053FB8040540B8040640B8040640B804053FB80305
          3EB804053DB8020339B903032DA80101053A00000000010207391928D5FF111D
          BDFF1321C9FF1824D1FF2B36D9FF3540DFFF1B2ADCFF1B29DAFF2B36DAFF2D37
          D4FF1421CAFF0E1AC1FF0D19B9FF1A27D1FF010308390A1356A7141FCCFF1520
          D3FF1724DBFF1A28E6FF1C2BF0FF1D2EF7FF2031FAFF1F2FF7FF1B2BEFFF1726
          E4FF141FD8FF29309FFF181D8AFF0D16BCFF0C1458A7070A5CB81018C2FF111C
          C6FF151FD2FF1825DDFF1B2AE9FF1E2EF3FF2030F8FF1D2FF4FF1C2AEBFF1623
          E0FF0F1471FF5C5D51FFC2C1B2FF040AA5FF050757B8050857B70D14B6FF0E16
          BBFF121CC7FF1621D4FF1927E2FF1D2DF1FF1F30F9FF1E2EF4FF1927E9FF1117
          75FF49483EFF35342EFF3C3E64FF0509ABFF030550B7040651B70A0FABFF0C12
          B0FF0D16B9FF0D17C6FF0C17CAFF0F1ED7FF1828F3FF1B2DFAFF0D1477FF4847
          3DFF383832FF222348FF0306A4FF05099DFF02034BB702044CB7070A9FFF070B
          A3FF000193FF474D93FF9AA1BBFFA8B1C5FF7A83B6FF1720A9FFB2B2AEFF3A3A
          32FF212245FF0205A0FF040796FF040494FF010147B7020148B7030596FF0000
          82FF9BA3B7FFF4C3A9FFF18048FFF07539FFF49B71FFE0DAD1FFB8BBBFFF5657
          93FF000092FF02038FFF03028CFF01038EFF000046B7000146B700008CFF6065
          9AFFF1B797FFEB6D21FFEA7631FFEA7934FFEC7934FFEE7C3DFFD0CFD0FF0000
          7CFF000088FF010188FF010189FF02018CFF000045B7000044B7000080FFC2C6
          CEFFEC8743FFEB924FFFEC9350FFEC9351FFED9555FFED914FFFECBB9AFF565A
          A3FF111298FF0F1094FF07088FFF01018EFF010146B7010246B705078CFFDDD4
          C8FFEBA159FFE9A361FFE9A361FFE9A463FFEAA668FFEBA767FFE4AF83FF777D
          BFFF1418A9FF181BA2FF17199FFF14159CFF020349B70B0B4DB70D0F9DFFBCBF
          C7FFEDB36DFFEDBC7AFFEEBD7BFFEEBE7DFFEFBE7EFFF0BF7CFFE1C19AFF5C63
          C4FF1B21BCFF1C21B0FF191EA9FF191BA7FF0C0D50B70B0D51B71418ACFF6F73
          BBFFD9C09AFFF2D18CFFF0D393FFEFD294FFF2D496FFEAC283FFC8C6C3FF222E
          D3FF222ACAFF1E25BDFF1D23B4FF1B20B2FF0B0E54B70E115CB11D23B8FF161D
          BCFF9CA0C7FFD3C29FFFE1C78CFFE8CE8FFFD7BF8DFFCBC7BBFF4B56DFFF2532
          E2FF2430D4FF232BC9FF2027C0FF1E24BAFF0F125FB10F154D681E24BFFF222A
          CAFF1B26D4FF5B64D6FF969CD1FF9CA1CCFF858DDEFF3544EFFF2938F3FF2936
          E7FF2632DCFF242ED0FF2129C7FF1E24C0FF0F154E680000000017216F842734
          C8F02A38DEFF293AEAFF293BF4FF2B3EFBFF2C3FFBFF3143F8FF3042F4FF2E3E
          ECFF2B3AE3FF2936DAFF2632C7F017216E8400000000}
        TabOrder = 22
        OnClick = cxButton1Click
      end
    end
    object cxPageControl1: TcxPageControl
      Left = 5
      Top = 129
      Width = 849
      Height = 395
      Color = 16053234
      ParentBackground = False
      ParentColor = False
      TabOrder = 1
      Properties.ActivePage = cxTabSheet2
      Properties.CustomButtons.Buttons = <>
      ClientRectBottom = 389
      ClientRectLeft = 3
      ClientRectRight = 843
      ClientRectTop = 29
      object cxTabSheet2: TcxTabSheet
        Caption = #3585#3634#3619#3648#3592#3634#3632#3648#3621#3639#3629#3604
        ImageIndex = 1
        object cxGroupBox6: TcxGroupBox
          Left = 0
          Top = 0
          Align = alTop
          Caption = #3585#3634#3619#3648#3592#3634#3632#3648#3621#3639#3629#3604
          TabOrder = 0
          Height = 103
          Width = 840
          object Label38: TLabel
            Left = 6
            Top = 33
            Width = 125
            Height = 16
            Caption = #3629#3634#3618#3640#3588#3619#3619#3616#3660#3605#3629#3609#3648#3592#3634#3632#3648#3621#3639#3629#3604
          end
          object Label39: TLabel
            Left = 199
            Top = 33
            Width = 38
            Height = 16
            Caption = #3626#3633#3611#3604#3634#3627#3660
          end
          object Label41: TLabel
            Left = 241
            Top = 33
            Width = 67
            Height = 16
            Caption = #3623#3633#3609#3607#3637#3656#3588#3633#3604#3585#3619#3629#3591
          end
          object Label42: TLabel
            Left = 434
            Top = 33
            Width = 71
            Height = 16
            Caption = #3623#3633#3609#3607#3637#3656#3618#3639#3609#3618#3633#3609#3612#3621
          end
          object Label43: TLabel
            Left = 613
            Top = 33
            Width = 89
            Height = 16
            Caption = #3623#3633#3609#3607#3637#3656#3623#3636#3609#3636#3592#3593#3633#3618#3607#3634#3619#3585
          end
          object Label45: TLabel
            Left = 615
            Top = 63
            Width = 55
            Height = 16
            Caption = 'VC Result'
          end
          object Label44: TLabel
            Left = 321
            Top = 65
            Width = 180
            Height = 16
            Caption = #3623#3633#3609#3607#3637#3656#3649#3614#3607#3618#3660#3607#3635#3651#3627#3657#3626#3636#3657#3609#3626#3640#3604#3585#3634#3619#3605#3633#3657#3591#3588#3619#3619#3616#3660
          end
          object cxDBSpinEdit3: TcxDBSpinEdit
            Left = 136
            Top = 30
            DataBinding.DataField = 'thalasseima_preg_age'
            DataBinding.DataSource = PersonANCDS
            Properties.Alignment.Horz = taCenter
            TabOrder = 0
            Width = 57
          end
          object cxDBDateEdit7: TcxDBDateEdit
            Left = 310
            Top = 30
            DataBinding.DataField = 'thalassemia_screen_date'
            DataBinding.DataSource = PersonANCDS
            Properties.View = cavClassic
            TabOrder = 1
            Width = 114
          end
          object cxDBDateEdit8: TcxDBDateEdit
            Left = 508
            Top = 30
            DataBinding.DataField = 'thalassemia_confirm_date'
            DataBinding.DataSource = PersonANCDS
            Properties.View = cavClassic
            TabOrder = 2
            Width = 103
          end
          object cxDBDateEdit9: TcxDBDateEdit
            Left = 709
            Top = 30
            DataBinding.DataField = 'thalassemia_prenatal_date'
            DataBinding.DataSource = PersonANCDS
            Properties.View = cavClassic
            TabOrder = 3
            Width = 121
          end
          object cxDBCheckBox4: TcxDBCheckBox
            Left = 21
            Top = 60
            Caption = #3607#3634#3619#3585#3651#3609#3588#3619#3619#3616#3660#3648#3611#3655#3609#3650#3619#3588' Thalassemia'
            DataBinding.DataField = 'thalassemia_prenatal_confirm'
            DataBinding.DataSource = PersonANCDS
            Properties.NullStyle = nssUnchecked
            Properties.ValueChecked = 'Y'
            Properties.ValueUnchecked = 'N'
            TabOrder = 4
          end
          object cxDBDateEdit10: TcxDBDateEdit
            Left = 508
            Top = 60
            DataBinding.DataField = 'thalassemia_prenatal_confirm_date'
            DataBinding.DataSource = PersonANCDS
            Properties.View = cavClassic
            TabOrder = 5
            Width = 103
          end
          object cxDBLookupComboBox16: TcxDBLookupComboBox
            Left = 681
            Top = 60
            DataBinding.DataField = 'anc_vc_result_id'
            DataBinding.DataSource = PersonANCDS
            Properties.IncrementalFilteringOptions = [ifoHighlightSearchText, ifoUseContainsOperator]
            Properties.KeyFieldNames = 'anc_vc_result_id'
            Properties.ListColumns = <
              item
                FieldName = 'anc_vc_result_name'
              end>
            Properties.ListSource = HOSxPPCUAccount2DataModule.ANCVcResultDS
            TabOrder = 6
            Width = 138
          end
        end
        object cxGroupBox4: TcxGroupBox
          Left = 0
          Top = 103
          Align = alTop
          Caption = #3616#3619#3619#3618#3634
          TabOrder = 1
          Height = 120
          Width = 840
          object Label23: TLabel
            Left = 28
            Top = 38
            Width = 67
            Height = 16
            Caption = #3612#3621#3585#3634#3619#3605#3619#3623#3592' '
          end
          object Label30: TLabel
            Left = 194
            Top = 38
            Width = 36
            Height = 16
            Caption = #3612#3621' OF'
          end
          object Label33: TLabel
            Left = 310
            Top = 38
            Width = 27
            Height = 16
            Caption = 'DCIP'
          end
          object Label35: TLabel
            Left = 26
            Top = 68
            Width = 57
            Height = 16
            Caption = 'Hb Typing'
          end
          object Label37: TLabel
            Left = 185
            Top = 68
            Width = 43
            Height = 16
            Caption = 'Alpha 1'
          end
          object Label48: TLabel
            Left = 498
            Top = 38
            Width = 95
            Height = 16
            Caption = #3611#3619#3632#3648#3616#3607#3588#3623#3634#3617#3648#3626#3637#3656#3618#3591
          end
          object cxDBLookupComboBox6: TcxDBLookupComboBox
            Left = 94
            Top = 35
            DataBinding.DataField = 'thalassaemia_result_id'
            DataBinding.DataSource = PersonANCDS
            Properties.IncrementalFilteringOptions = [ifoHighlightSearchText, ifoUseContainsOperator]
            Properties.KeyFieldNames = 'thalassaemia_result_id'
            Properties.ListColumns = <
              item
                FieldName = 'thalassaemia_result_name'
              end>
            Properties.ListSource = HOSxPPCUAccount2DataModule.ThalassemiaResultDS
            TabOrder = 0
            Width = 88
          end
          object cxDBLookupComboBox8: TcxDBLookupComboBox
            Left = 237
            Top = 35
            DataBinding.DataField = 'thalasseima_wife_of_result'
            DataBinding.DataSource = PersonANCDS
            Properties.IncrementalFilteringOptions = [ifoHighlightSearchText, ifoUseContainsOperator]
            Properties.KeyFieldNames = 'lookup_id'
            Properties.ListColumns = <
              item
                FieldName = 'lookup_name'
              end>
            Properties.ListSource = HOSxPPCUAccount2DataModule.LookupNormalDS
            TabOrder = 1
            Width = 64
          end
          object cxDBLookupComboBox11: TcxDBLookupComboBox
            Left = 349
            Top = 35
            DataBinding.DataField = 'thalasseima_wife_dcip_result'
            DataBinding.DataSource = PersonANCDS
            Properties.IncrementalFilteringOptions = [ifoHighlightSearchText, ifoUseContainsOperator]
            Properties.KeyFieldNames = 'lookup_id'
            Properties.ListColumns = <
              item
                FieldName = 'lookup_name'
              end>
            Properties.ListSource = HOSxPPCUAccount2DataModule.LookupNormalDS
            TabOrder = 2
            Width = 64
          end
          object cxDBLookupComboBox13: TcxDBLookupComboBox
            Left = 94
            Top = 65
            DataBinding.DataField = 'thalasseima_wife_hbtyping_result'
            DataBinding.DataSource = PersonANCDS
            Properties.IncrementalFilteringOptions = [ifoHighlightSearchText, ifoUseContainsOperator]
            Properties.KeyFieldNames = 'lookup_id'
            Properties.ListColumns = <
              item
                FieldName = 'lookup_name'
              end>
            Properties.ListSource = HOSxPPCUAccount2DataModule.LookupNormalDS
            TabOrder = 3
            Width = 88
          end
          object cxDBLookupComboBox15: TcxDBLookupComboBox
            Left = 237
            Top = 65
            DataBinding.DataField = 'thalasseima_wife_alpha1_result'
            DataBinding.DataSource = PersonANCDS
            Properties.IncrementalFilteringOptions = [ifoHighlightSearchText, ifoUseContainsOperator]
            Properties.KeyFieldNames = 'lookup_id'
            Properties.ListColumns = <
              item
                FieldName = 'lookup_name'
              end>
            Properties.ListSource = HOSxPPCUAccount2DataModule.LookupNormalDS
            TabOrder = 4
            Width = 64
          end
          object cxDBLookupComboBox17: TcxDBLookupComboBox
            Left = 307
            Top = 65
            DataBinding.DataField = 'thalassaemia_wife_location_type_id'
            DataBinding.DataSource = PersonANCDS
            Properties.IncrementalFilteringOptions = [ifoHighlightSearchText, ifoUseContainsOperator]
            Properties.KeyFieldNames = 'thalassaemia_location_type_id'
            Properties.ListColumns = <
              item
                FieldName = 'thalassaemia_location_type_name'
              end>
            Properties.ListSource = HOSxPPCUAccount2DataModule.ThalassaemiaLocationTypeDS
            TabOrder = 5
            Width = 106
          end
          object cxDBLookupComboBox18: TcxDBLookupComboBox
            Left = 594
            Top = 35
            DataBinding.DataField = 'wife_thalassaemia_risk_type_id'
            DataBinding.DataSource = PersonANCDS
            Properties.IncrementalFilteringOptions = [ifoHighlightSearchText, ifoUseContainsOperator]
            Properties.KeyFieldNames = 'thalassaemia_risk_type_id'
            Properties.ListColumns = <
              item
                FieldName = 'thalassaemia_risk_type_name'
              end>
            Properties.ListSource = HOSxPPCUAccount2DataModule.ThalassaemiaRiskTypeDS
            TabOrder = 6
            Width = 213
          end
        end
        object cxGroupBox5: TcxGroupBox
          Left = 0
          Top = 223
          Align = alTop
          Caption = #3626#3634#3617#3637
          TabOrder = 2
          Height = 122
          Width = 840
          object Label24: TLabel
            Left = 28
            Top = 41
            Width = 63
            Height = 16
            Caption = #3612#3621#3585#3634#3619#3605#3619#3623#3592
          end
          object Label31: TLabel
            Left = 191
            Top = 41
            Width = 36
            Height = 16
            Caption = #3612#3621' OF'
          end
          object Label32: TLabel
            Left = 303
            Top = 41
            Width = 27
            Height = 16
            Caption = 'DCIP'
          end
          object Label34: TLabel
            Left = 23
            Top = 71
            Width = 57
            Height = 16
            Caption = 'Hb Typing'
          end
          object Label36: TLabel
            Left = 183
            Top = 71
            Width = 43
            Height = 16
            Caption = 'Alpha 1'
          end
          object Label49: TLabel
            Left = 498
            Top = 41
            Width = 95
            Height = 16
            Caption = #3611#3619#3632#3648#3616#3607#3588#3623#3634#3617#3648#3626#3637#3656#3618#3591
          end
          object cxDBLookupComboBox7: TcxDBLookupComboBox
            Left = 89
            Top = 38
            DataBinding.DataField = 'husban_thalassaemia_result_id'
            DataBinding.DataSource = PersonANCDS
            Properties.IncrementalFilteringOptions = [ifoHighlightSearchText, ifoUseContainsOperator]
            Properties.KeyFieldNames = 'thalassaemia_result_id'
            Properties.ListColumns = <
              item
                FieldName = 'thalassaemia_result_name'
              end>
            Properties.ListSource = HOSxPPCUAccount2DataModule.ThalassemiaResultDS
            TabOrder = 0
            Width = 88
          end
          object cxDBLookupComboBox9: TcxDBLookupComboBox
            Left = 232
            Top = 38
            DataBinding.DataField = 'thalasseima_husband_of_result'
            DataBinding.DataSource = PersonANCDS
            Properties.IncrementalFilteringOptions = [ifoHighlightSearchText, ifoUseContainsOperator]
            Properties.KeyFieldNames = 'lookup_id'
            Properties.ListColumns = <
              item
                FieldName = 'lookup_name'
              end>
            Properties.ListSource = HOSxPPCUAccount2DataModule.LookupNormalDS
            TabOrder = 1
            Width = 64
          end
          object cxDBLookupComboBox10: TcxDBLookupComboBox
            Left = 344
            Top = 38
            DataBinding.DataField = 'thalasseima_husband_dcip_result'
            DataBinding.DataSource = PersonANCDS
            Properties.IncrementalFilteringOptions = [ifoHighlightSearchText, ifoUseContainsOperator]
            Properties.KeyFieldNames = 'lookup_id'
            Properties.ListColumns = <
              item
                FieldName = 'lookup_name'
              end>
            Properties.ListSource = HOSxPPCUAccount2DataModule.LookupNormalDS
            TabOrder = 2
            Width = 64
          end
          object cxDBLookupComboBox12: TcxDBLookupComboBox
            Left = 89
            Top = 68
            DataBinding.DataField = 'thalasseima_husband_hbtyping_result'
            DataBinding.DataSource = PersonANCDS
            Properties.IncrementalFilteringOptions = [ifoHighlightSearchText, ifoUseContainsOperator]
            Properties.KeyFieldNames = 'lookup_id'
            Properties.ListColumns = <
              item
                FieldName = 'lookup_name'
              end>
            Properties.ListSource = HOSxPPCUAccount2DataModule.LookupNormalDS
            TabOrder = 3
            Width = 88
          end
          object cxDBLookupComboBox14: TcxDBLookupComboBox
            Left = 232
            Top = 68
            DataBinding.DataField = 'thalasseima_husband_alpha1_result'
            DataBinding.DataSource = PersonANCDS
            Properties.IncrementalFilteringOptions = [ifoHighlightSearchText, ifoUseContainsOperator]
            Properties.KeyFieldNames = 'lookup_id'
            Properties.ListColumns = <
              item
                FieldName = 'lookup_name'
              end>
            Properties.ListSource = HOSxPPCUAccount2DataModule.LookupNormalDS
            TabOrder = 4
            Width = 64
          end
          object cxDBLookupComboBox19: TcxDBLookupComboBox
            Left = 594
            Top = 38
            DataBinding.DataField = 'husband_thalassaemia_risk_type_id'
            DataBinding.DataSource = PersonANCDS
            Properties.IncrementalFilteringOptions = [ifoHighlightSearchText, ifoUseContainsOperator]
            Properties.KeyFieldNames = 'thalassaemia_risk_type_id'
            Properties.ListColumns = <
              item
                FieldName = 'thalassaemia_risk_type_name'
              end>
            Properties.ListSource = HOSxPPCUAccount2DataModule.ThalassaemiaRiskTypeDS
            TabOrder = 5
            Width = 213
          end
        end
      end
      object cxTabSheet1: TcxTabSheet
        Caption = #3612#3621' Ultrasound'
        ImageIndex = 0
        object cxGroupBox2: TcxGroupBox
          Left = 0
          Top = 0
          Align = alClient
          Caption = #3612#3621' Ultrasound'
          TabOrder = 0
          Height = 360
          Width = 840
          object cxDBMemo1: TcxDBMemo
            Left = 3
            Top = 18
            Align = alClient
            DataBinding.DataField = 'ultrasound_text'
            DataBinding.DataSource = PersonANCDS
            Properties.ScrollBars = ssVertical
            TabOrder = 0
            Height = 333
            Width = 834
          end
        end
      end
      object cxTabSheet3: TcxTabSheet
        Caption = #3585#3634#3619#3623#3634#3591#3649#3612#3609#3585#3634#3619#3588#3621#3629#3604
        ImageIndex = 2
        object cxGroupBox3: TcxGroupBox
          Left = 0
          Top = 0
          Align = alClient
          Caption = #3649#3612#3609#3585#3634#3619#3588#3621#3629#3604
          TabOrder = 0
          ExplicitLeft = 122
          ExplicitTop = 72
          ExplicitWidth = 185
          ExplicitHeight = 105
          DesignSize = (
            840
            354)
          Height = 360
          Width = 840
          object cxLabel1: TcxLabel
            Left = 20
            Top = 32
            Caption = #3619#3614'. '#3607#3637#3656#3623#3634#3591#3649#3612#3609#3592#3632#3652#3611#3588#3621#3629#3604#3610#3640#3605#3619
            Transparent = True
          end
          object cxDBLookupComboBox1: TcxDBLookupComboBox
            Left = 190
            Top = 31
            DataBinding.DataField = 'planned_delivery_hospital_code'
            DataBinding.DataSource = PersonANCDS
            Properties.IncrementalFilteringOptions = [ifoHighlightSearchText, ifoUseContainsOperator]
            Properties.KeyFieldNames = 'hospcode'
            Properties.ListColumns = <
              item
                FieldName = 'hospname'
              end>
            Properties.ListSource = HOSxPPCUAccount2DataModule.HospcodeDS
            TabOrder = 1
            Width = 524
          end
          object cxButton2: TcxButton
            Left = 720
            Top = 31
            Width = 57
            Height = 24
            Caption = #3588#3657#3609#3627#3634
            TabOrder = 2
          end
          object cxLabel2: TcxLabel
            Left = 126
            Top = 62
            Caption = #3627#3617#3634#3618#3648#3627#3605#3640
            Transparent = True
          end
          object cxDBMemo2: TcxDBMemo
            Left = 190
            Top = 61
            Anchors = [akLeft, akTop, akRight, akBottom]
            DataBinding.DataField = 'planned_delivery_hospital_note'
            DataBinding.DataSource = PersonANCDS
            Properties.ScrollBars = ssVertical
            TabOrder = 4
            Height = 247
            Width = 616
          end
        end
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
      CaptionOptions.Visible = False
      Control = cxGroupBox1
      ControlOptions.AutoColor = True
      ControlOptions.OriginalHeight = 117
      ControlOptions.OriginalWidth = 876
      ControlOptions.ShowBorder = False
      Index = 0
    end
    object dxLayoutControl1Item2: TdxLayoutItem
      Parent = dxLayoutControl1Group_Root
      AlignHorz = ahClient
      Control = cxPageControl1
      ControlOptions.AutoColor = True
      ControlOptions.OriginalHeight = 395
      ControlOptions.OriginalWidth = 876
      ControlOptions.ShowBorder = False
      Index = 1
    end
  end
  object PersonANCCDS: TClientDataSet
    Active = True
    Aggregates = <>
    CommandText = 'select * from person_anc  limit 0'#13#10
    Params = <>
    BeforePost = PersonANCCDSBeforePost
    OnNewRecord = PersonANCCDSNewRecord
    Left = 336
    Top = 117
    Data = {
      8D2200009619E0BD01000000180000006A0000000000030000008D220D706572
      736F6E5F616E635F69640400010000000100064F524947494E02004980190070
      6572736F6E5F616E632E706572736F6E5F616E635F69640009706572736F6E5F
      69640400010000000100064F524947494E020049801500706572736F6E5F616E
      632E706572736F6E5F6964000D706572736F6E5F616E635F6E6F040001000000
      0100064F524947494E020049801900706572736F6E5F616E632E706572736F6E
      5F616E635F6E6F0011616E635F72656769737465725F64617465040006000000
      0100064F524947494E020049801D00706572736F6E5F616E632E616E635F7265
      6769737465725F646174650012616E635F72656769737465725F737461666601
      00490000000200055749445448020002001900064F524947494E020049801E00
      706572736F6E5F616E632E616E635F72656769737465725F7374616666001076
      616363696E655F7474315F646174650400060000000100064F524947494E0200
      49801C00706572736F6E5F616E632E76616363696E655F7474315F6461746500
      1076616363696E655F7474325F646174650400060000000100064F524947494E
      020049801C00706572736F6E5F616E632E76616363696E655F7474325F646174
      65001076616363696E655F7474335F646174650400060000000100064F524947
      494E020049801C00706572736F6E5F616E632E76616363696E655F7474335F64
      617465001076616363696E655F7474345F646174650400060000000100064F52
      4947494E020049801C00706572736F6E5F616E632E76616363696E655F747434
      5F64617465001376616363696E655F74745F636F6D706C657465010049000000
      03000753554254595045020049000A0046697865644368617200055749445448
      020002000100064F524947494E020049801F00706572736F6E5F616E632E7661
      6363696E655F74745F636F6D706C6574650011626C6F6F645F636865636B315F
      646174650400060000000100064F524947494E020049801D00706572736F6E5F
      616E632E626C6F6F645F636865636B315F646174650011626C6F6F645F636865
      636B325F646174650400060000000100064F524947494E020049801D00706572
      736F6E5F616E632E626C6F6F645F636865636B325F646174650012626C6F6F64
      5F7664726C315F726573756C7401004900000002000557494454480200020019
      00064F524947494E020049801E00706572736F6E5F616E632E626C6F6F645F76
      64726C315F726573756C740012626C6F6F645F7664726C325F726573756C7401
      00490000000200055749445448020002001900064F524947494E020049801E00
      706572736F6E5F616E632E626C6F6F645F7664726C325F726573756C74001162
      6C6F6F645F686976315F726573756C7401004900000002000557494454480200
      02001900064F524947494E020049801D00706572736F6E5F616E632E626C6F6F
      645F686976315F726573756C740011626C6F6F645F686976325F726573756C74
      0100490000000200055749445448020002001900064F524947494E020049801D
      00706572736F6E5F616E632E626C6F6F645F686976325F726573756C74000F62
      6C6F6F645F6F665F726573756C74010049000000020005574944544802000200
      0A00064F524947494E020049801B00706572736F6E5F616E632E626C6F6F645F
      6F665F726573756C740010626C6F6F645F6863745F726573756C740100490000
      000200055749445448020002000A00064F524947494E020049801C0070657273
      6F6E5F616E632E626C6F6F645F6863745F726573756C74000F626C6F6F645F68
      63745F67726164650400010000000100064F524947494E020049801B00706572
      736F6E5F616E632E626C6F6F645F6863745F677261646500177072655F6C6162
      6F725F73657276696365315F646174650400060000000100064F524947494E02
      0049802300706572736F6E5F616E632E7072655F6C61626F725F736572766963
      65315F6461746500177072655F6C61626F725F73657276696365325F64617465
      0400060000000100064F524947494E020049802300706572736F6E5F616E632E
      7072655F6C61626F725F73657276696365325F6461746500177072655F6C6162
      6F725F73657276696365335F646174650400060000000100064F524947494E02
      0049802300706572736F6E5F616E632E7072655F6C61626F725F736572766963
      65335F6461746500177072655F6C61626F725F73657276696365345F64617465
      0400060000000100064F524947494E020049802300706572736F6E5F616E632E
      7072655F6C61626F725F73657276696365345F64617465001166697273745F64
      6F63746F725F646174650400060000000100064F524947494E020049801D0070
      6572736F6E5F616E632E66697273745F646F63746F725F646174650009726973
      6B5F6C697374010049000000020005574944544802000200FA00064F52494749
      4E020049801500706572736F6E5F616E632E7269736B5F6C697374000F726973
      6B5F72656665725F646174650400060000000100064F524947494E020049801B
      00706572736F6E5F616E632E7269736B5F72656665725F646174650011707379
      63686F5F6576616C5F73636F72650400010000000100064F524947494E020049
      801D00706572736F6E5F616E632E70737963686F5F6576616C5F73636F726500
      10616E635F76635F726573756C745F69640400010000000100064F524947494E
      020049801C00706572736F6E5F616E632E616E635F76635F726573756C745F69
      640018706F73745F6C61626F725F73657276696365315F646174650400060000
      000100064F524947494E020049802400706572736F6E5F616E632E706F73745F
      6C61626F725F73657276696365315F646174650018706F73745F6C61626F725F
      73657276696365325F646174650400060000000100064F524947494E02004980
      2400706572736F6E5F616E632E706F73745F6C61626F725F7365727669636532
      5F646174650007707265675F6E6F0400010000000100064F524947494E020049
      801300706572736F6E5F616E632E707265675F6E6F000F707265675F62656769
      6E5F646174650400060000000100064F524947494E020049801B00706572736F
      6E5F616E632E707265675F626567696E5F64617465000A6C61626F725F646174
      650400060000000100064F524947494E020049801600706572736F6E5F616E63
      2E6C61626F725F64617465000E6C61626F725F706C6163655F69640400010000
      000100064F524947494E020049801A00706572736F6E5F616E632E6C61626F72
      5F706C6163655F696400146C61626F725F646F63746F725F747970655F696404
      00010000000100064F524947494E020049802000706572736F6E5F616E632E6C
      61626F725F646F63746F725F747970655F69640011616C6976655F6368696C64
      5F636F756E740400010000000100064F524947494E020049801D00706572736F
      6E5F616E632E616C6976655F6368696C645F636F756E740010646561645F6368
      696C645F636F756E740400010000000100064F524947494E020049801C007065
      72736F6E5F616E632E646561645F6368696C645F636F756E7400106375727265
      6E745F707265675F6167650400010000000100064F524947494E020049801C00
      706572736F6E5F616E632E63757272656E745F707265675F616765000A616E63
      5F66696E69736801004900000003000753554254595045020049000A00466978
      65644368617200055749445448020002000100064F524947494E020049801600
      706572736F6E5F616E632E616E635F66696E697368000F6C61626F725F737461
      7475735F69640400010000000100064F524947494E020049801B00706572736F
      6E5F616E632E6C61626F725F7374617475735F69640003656463040006000000
      0100064F524947494E020049800F00706572736F6E5F616E632E65646300036C
      6D700400060000000100064F524947494E020049800F00706572736F6E5F616E
      632E6C6D700018706F73745F6C61626F725F73657276696365335F6461746504
      00060000000100064F524947494E020049802400706572736F6E5F616E632E70
      6F73745F6C61626F725F73657276696365335F64617465000E6C61626F75725F
      747970655F69640400010000000100064F524947494E020049801A0070657273
      6F6E5F616E632E6C61626F75725F747970655F6964000F6C61626F75725F686F
      7370636F64650100490000000200055749445448020002000900064F52494749
      4E020049801B00706572736F6E5F616E632E6C61626F75725F686F7370636F64
      65000B6C61626F725F6963643130010049000000020005574944544802000200
      0700064F524947494E020049801700706572736F6E5F616E632E6C61626F725F
      6963643130000267610400010000000100064F524947494E020049800E007065
      72736F6E5F616E632E6761000964697363686172676501004900000003000753
      554254595045020049000A004669786564436861720005574944544802000200
      0100064F524947494E020049801500706572736F6E5F616E632E646973636861
      726765000E6469736368617267655F646174650400060000000100064F524947
      494E020049801A00706572736F6E5F616E632E6469736368617267655F646174
      65000A7269736B5F6C6576656C0400010000000100064F524947494E02004980
      1600706572736F6E5F616E632E7269736B5F6C6576656C000A6F75745F726567
      696F6E01004900000003000753554254595045020049000A0046697865644368
      617200055749445448020002000100064F524947494E02004980160070657273
      6F6E5F616E632E6F75745F726567696F6E00167468616C61737361656D69615F
      726573756C745F69640400010000000100064F524947494E0200498022007065
      72736F6E5F616E632E7468616C61737361656D69615F726573756C745F696400
      08686F735F677569640100490000000200055749445448020002002600064F52
      4947494E020049801400706572736F6E5F616E632E686F735F67756964000B6C
      6173745F7570646174650800080000000100064F524947494E02004980170070
      6572736F6E5F616E632E6C6173745F75706461746500086E65775F626F6F6B01
      004900000003000753554254595045020049000A004669786564436861720005
      5749445448020002000100064F524947494E020049801400706572736F6E5F61
      6E632E6E65775F626F6F6B00197072655F6C61626F725F736572766963655F70
      657263656E740800040000000100064F524947494E020049802500706572736F
      6E5F616E632E7072655F6C61626F725F736572766963655F70657263656E7400
      1A706F73745F6C61626F725F736572766963655F70657263656E740800040000
      000100064F524947494E020049802600706572736F6E5F616E632E706F73745F
      6C61626F725F736572766963655F70657263656E7400147468616C6173736569
      6D615F707265675F6167650400010000000100064F524947494E020049802000
      706572736F6E5F616E632E7468616C61737365696D615F707265675F61676500
      1A7468616C61737365696D615F776966655F6F665F726573756C740100490000
      0003000753554254595045020049000A00466978656443686172000557494454
      48020002000100064F524947494E020049802600706572736F6E5F616E632E74
      68616C61737365696D615F776966655F6F665F726573756C74001D7468616C61
      737365696D615F68757362616E645F6F665F726573756C740100490000000300
      0753554254595045020049000A00466978656443686172000557494454480200
      02000100064F524947494E020049802900706572736F6E5F616E632E7468616C
      61737365696D615F68757362616E645F6F665F726573756C74001C7468616C61
      737365696D615F776966655F646369705F726573756C74010049000000030007
      53554254595045020049000A0046697865644368617200055749445448020002
      000100064F524947494E020049802800706572736F6E5F616E632E7468616C61
      737365696D615F776966655F646369705F726573756C74001F7468616C617373
      65696D615F68757362616E645F646369705F726573756C740100490000000300
      0753554254595045020049000A00466978656443686172000557494454480200
      02000100064F524947494E020049802B00706572736F6E5F616E632E7468616C
      61737365696D615F68757362616E645F646369705F726573756C74001F746861
      6C61737365696D615F776966655F6862747970696E675F726573756C01004900
      000004000753554254595045020049000A004669786564436861720005574944
      5448020002000100094649454C444E414D450200498021007468616C61737365
      696D615F776966655F6862747970696E675F726573756C7400064F524947494E
      020049802C00706572736F6E5F616E632E7468616C61737365696D615F776966
      655F6862747970696E675F726573756C74001F7468616C61737365696D615F68
      757362616E645F6862747970696E675F72650100490000000400075355425459
      5045020049000A00466978656443686172000557494454480200020001000946
      49454C444E414D450200498024007468616C61737365696D615F68757362616E
      645F6862747970696E675F726573756C7400064F524947494E020049802F0070
      6572736F6E5F616E632E7468616C61737365696D615F68757362616E645F6862
      747970696E675F726573756C74001E7468616C61737365696D615F776966655F
      616C706861315F726573756C7401004900000003000753554254595045020049
      000A0046697865644368617200055749445448020002000100064F524947494E
      020049802A00706572736F6E5F616E632E7468616C61737365696D615F776966
      655F616C706861315F726573756C74001F7468616C61737365696D615F687573
      62616E645F616C706861315F7265737501004900000004000753554254595045
      020049000A004669786564436861720005574944544802000200010009464945
      4C444E414D450200498022007468616C61737365696D615F68757362616E645F
      616C706861315F726573756C7400064F524947494E020049802D00706572736F
      6E5F616E632E7468616C61737365696D615F68757362616E645F616C70686131
      5F726573756C7400197468616C61737365696D615F776966655F64785F696364
      31300100490000000200055749445448020002000900064F524947494E020049
      802500706572736F6E5F616E632E7468616C61737365696D615F776966655F64
      785F6963643130001C7468616C61737365696D615F68757362616E645F64785F
      69636431300100490000000200055749445448020002000900064F524947494E
      020049802800706572736F6E5F616E632E7468616C61737365696D615F687573
      62616E645F64785F6963643130000D68757362616E645F706E616D6501004900
      00000200055749445448020002001E00064F524947494E020049801900706572
      736F6E5F616E632E68757362616E645F706E616D65000D68757362616E645F66
      6E616D650100490000000200055749445448020002003C00064F524947494E02
      0049801900706572736F6E5F616E632E68757362616E645F666E616D65000D68
      757362616E645F6C6E616D650100490000000200055749445448020002003C00
      064F524947494E020049801900706572736F6E5F616E632E68757362616E645F
      6C6E616D65001168757362616E645F706572736F6E5F69640400010000000100
      064F524947494E020049801D00706572736F6E5F616E632E68757362616E645F
      706572736F6E5F6964000E64656E74616C5F74785F6461746504000600000001
      00064F524947494E020049801A00706572736F6E5F616E632E64656E74616C5F
      74785F64617465001D68757362616E5F7468616C61737361656D69615F726573
      756C745F69640400010000000100064F524947494E020049802900706572736F
      6E5F616E632E68757362616E5F7468616C61737361656D69615F726573756C74
      5F696400177072655F6C61626F725F73657276696365355F6461746504000600
      00000100064F524947494E020049802300706572736F6E5F616E632E7072655F
      6C61626F725F73657276696365355F6461746500177468616C617373656D6961
      5F73637265656E5F646174650400060000000100064F524947494E0200498023
      00706572736F6E5F616E632E7468616C617373656D69615F73637265656E5F64
      61746500187468616C617373656D69615F636F6E6669726D5F64617465040006
      0000000100064F524947494E020049802400706572736F6E5F616E632E746861
      6C617373656D69615F636F6E6669726D5F6461746500197468616C617373656D
      69615F7072656E6174616C5F646174650400060000000100064F524947494E02
      0049802500706572736F6E5F616E632E7468616C617373656D69615F7072656E
      6174616C5F64617465001C7468616C617373656D69615F7072656E6174616C5F
      636F6E6669726D01004900000003000753554254595045020049000A00466978
      65644368617200055749445448020002000100064F524947494E020049802800
      706572736F6E5F616E632E7468616C617373656D69615F7072656E6174616C5F
      636F6E6669726D001F7468616C617373656D69615F7072656E6174616C5F636F
      6E6669726D5F64610400060000000200094649454C444E414D45020049802200
      7468616C617373656D69615F7072656E6174616C5F636F6E6669726D5F646174
      6500064F524947494E020049802D00706572736F6E5F616E632E7468616C6173
      73656D69615F7072656E6174616C5F636F6E6669726D5F64617465000B6C6D70
      5F66726F6D5F757301004900000003000753554254595045020049000A004669
      7865644368617200055749445448020002000100064F524947494E0200498017
      00706572736F6E5F616E632E6C6D705F66726F6D5F7573001376616363696E65
      5F6474616E63315F646174650400060000000100064F524947494E020049801F
      00706572736F6E5F616E632E76616363696E655F6474616E63315F6461746500
      1376616363696E655F6474616E63325F646174650400060000000100064F5249
      47494E020049801F00706572736F6E5F616E632E76616363696E655F6474616E
      63325F64617465001376616363696E655F6474616E63335F6461746504000600
      00000100064F524947494E020049801F00706572736F6E5F616E632E76616363
      696E655F6474616E63335F64617465001376616363696E655F6474616E63345F
      646174650400060000000100064F524947494E020049801F00706572736F6E5F
      616E632E76616363696E655F6474616E63345F64617465001376616363696E65
      5F6474616E63355F646174650400060000000100064F524947494E020049801F
      00706572736F6E5F616E632E76616363696E655F6474616E63355F6461746500
      0F756C747261736F756E645F7465787404004B00000002000753554254595045
      0200490005005465787400064F524947494E020049801B00706572736F6E5F61
      6E632E756C747261736F756E645F746578740015666F7263655F636F6D706C65
      74655F6578706F727401004900000003000753554254595045020049000A0046
      697865644368617200055749445448020002000100064F524947494E02004980
      2100706572736F6E5F616E632E666F7263655F636F6D706C6574655F6578706F
      72740013666F7263655F636F6D706C6574655F64617465040006000000010006
      4F524947494E020049801F00706572736F6E5F616E632E666F7263655F636F6D
      706C6574655F64617465000973656E645F6E68736F0100490000000300075355
      4254595045020049000A00466978656443686172000557494454480200020001
      00064F524947494E020049801500706572736F6E5F616E632E73656E645F6E68
      736F000E6E68736F5F73656E645F646174650400060000000100064F52494749
      4E020049801A00706572736F6E5F616E632E6E68736F5F73656E645F64617465
      000E6E68736F5F73656E645F74696D650400070000000100064F524947494E02
      0049801A00706572736F6E5F616E632E6E68736F5F73656E645F74696D65000F
      6E68736F5F73656E645F73746166660100490000000200055749445448020002
      001400064F524947494E020049801B00706572736F6E5F616E632E6E68736F5F
      73656E645F7374616666000C6E68736F5F646174615F6F6B0100490000000300
      0753554254595045020049000A00466978656443686172000557494454480200
      02000100064F524947494E020049801800706572736F6E5F616E632E6E68736F
      5F646174615F6F6B00106E68736F5F7265706C795F6572726F72010049000000
      03000753554254595045020049000A0046697865644368617200055749445448
      020002000100064F524947494E020049801C00706572736F6E5F616E632E6E68
      736F5F7265706C795F6572726F72000F6E68736F5F6572726F725F636F646501
      00490000000200055749445448020002003200064F524947494E020049801B00
      706572736F6E5F616E632E6E68736F5F6572726F725F636F6465001A6E68736F
      5F7265706C795F7570646174655F6461746574696D650800080000000100064F
      524947494E020049802600706572736F6E5F616E632E6E68736F5F7265706C79
      5F7570646174655F6461746574696D65001F7468616C61737361656D69615F77
      6966655F6C6F636174696F6E5F747970650400010000000200094649454C444E
      414D450200498023007468616C61737361656D69615F776966655F6C6F636174
      696F6E5F747970655F696400064F524947494E020049802E00706572736F6E5F
      616E632E7468616C61737361656D69615F776966655F6C6F636174696F6E5F74
      7970655F6964000D736572766963655F636F756E740400010000000100064F52
      4947494E020049801900706572736F6E5F616E632E736572766963655F636F75
      6E74001E776966655F7468616C61737361656D69615F7269736B5F747970655F
      69640400010000000100064F524947494E020049802A00706572736F6E5F616E
      632E776966655F7468616C61737361656D69615F7269736B5F747970655F6964
      001F68757362616E645F7468616C61737361656D69615F7269736B5F74797065
      5F0400010000000200094649454C444E414D4502004980220068757362616E64
      5F7468616C61737361656D69615F7269736B5F747970655F696400064F524947
      494E020049802D00706572736F6E5F616E632E68757362616E645F7468616C61
      737361656D69615F7269736B5F747970655F696400086861735F7269736B0100
      4900000003000753554254595045020049000A00466978656443686172000557
      49445448020002000100064F524947494E020049801400706572736F6E5F616E
      632E6861735F7269736B001B666F7263655F6C61626F725F636F6D706C657465
      5F6578706F727401004900000003000753554254595045020049000A00466978
      65644368617200055749445448020002000100064F524947494E020049802700
      706572736F6E5F616E632E666F7263655F6C61626F725F636F6D706C6574655F
      6578706F72740019666F7263655F6C61626F725F636F6D706C6574655F646174
      650400060000000100064F524947494E020049802500706572736F6E5F616E63
      2E666F7263655F6C61626F725F636F6D706C6574655F64617465001E706C616E
      6E65645F64656C69766572795F686F73706974616C5F636F6465010049000000
      0200055749445448020002000900064F524947494E020049802A00706572736F
      6E5F616E632E706C616E6E65645F64656C69766572795F686F73706974616C5F
      636F6465001E706C616E6E65645F64656C69766572795F686F73706974616C5F
      6E6F7465020049000000020005574944544802000200D007064F524947494E02
      0049802A00706572736F6E5F616E632E706C616E6E65645F64656C6976657279
      5F686F73706974616C5F6E6F7465000000}
  end
  object PersonANCDS: TDataSource
    DataSet = PersonANCCDS
    Left = 444
    Top = 109
  end
  object dxLayoutLookAndFeelList1: TdxLayoutLookAndFeelList
    Left = 48
    Top = 11
    object dxLayoutSkinLookAndFeel1: TdxLayoutSkinLookAndFeel
      Offsets.RootItemsAreaOffsetHorz = 3
      Offsets.RootItemsAreaOffsetVert = 3
      PixelsPerInch = 96
    end
  end
end
