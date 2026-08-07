object HOSxPPCUAccount2LaborDetailFrame: THOSxPPCUAccount2LaborDetailFrame
  Left = 0
  Top = 0
  Width = 811
  Height = 593
  Font.Charset = DEFAULT_CHARSET
  Font.Color = clWindowText
  Font.Height = -13
  Font.Name = 'Tahoma'
  Font.Style = []
  ParentFont = False
  TabOrder = 0
  object cxGroupBox1: TcxGroupBox
    Left = 0
    Top = 0
    Align = alTop
    Caption = #3586#3657#3629#3617#3641#3621#3585#3634#3619#3588#3621#3629#3604
    TabOrder = 0
    Height = 164
    Width = 811
    object Label15: TLabel
      Left = 15
      Top = 21
      Width = 55
      Height = 16
      Caption = #3623#3633#3609#3607#3637#3656#3588#3621#3629#3604
      Transparent = True
    end
    object Label16: TLabel
      Left = 260
      Top = 21
      Width = 71
      Height = 16
      Caption = #3626#3606#3634#3609#3607#3637#3656#3588#3621#3629#3604
      Transparent = True
    end
    object Label17: TLabel
      Left = 513
      Top = 21
      Width = 55
      Height = 16
      Caption = #3612#3641#3657#3607#3635#3588#3621#3629#3604
      Transparent = True
    end
    object Label21: TLabel
      Left = 15
      Top = 49
      Width = 65
      Height = 16
      Caption = #3623#3636#3608#3637#3585#3634#3619#3588#3621#3629#3604
      Transparent = True
    end
    object Label26: TLabel
      Left = 259
      Top = 49
      Width = 116
      Height = 16
      Caption = #3626#3606#3634#3609#3614#3618#3634#3610#3634#3621#3607#3637#3656#3588#3621#3629#3604
      Transparent = True
    end
    object Label27: TLabel
      Left = 15
      Top = 76
      Width = 105
      Height = 16
      Caption = #3612#3621#3623#3636#3609#3636#3592#3593#3633#3618#3585#3634#3619#3588#3621#3629#3604
      Transparent = True
    end
    object Label18: TLabel
      Left = 47
      Top = 103
      Width = 100
      Height = 16
      Caption = #3592#3635#3609#3623#3609#3648#3604#3655#3585#3648#3585#3636#3604#3617#3637#3594#3637#3614
      Transparent = True
    end
    object Label19: TLabel
      Left = 42
      Top = 130
      Width = 105
      Height = 16
      Caption = #3592#3635#3609#3623#3609#3648#3604#3655#3585#3648#3585#3636#3604#3652#3619#3657#3594#3637#3614
      Transparent = True
    end
    object cxDBDateEdit2: TcxDBDateEdit
      Left = 97
      Top = 19
      DataBinding.DataField = 'labor_date'
      DataBinding.DataSource = PersonANCDS
      Properties.UseNullString = True
      Properties.View = cavClassic
      TabOrder = 0
      Width = 152
    end
    object cxDBLookupComboBox1: TcxDBLookupComboBox
      Left = 334
      Top = 19
      DataBinding.DataField = 'labor_place_id'
      DataBinding.DataSource = PersonANCDS
      Properties.IncrementalFilteringOptions = [ifoHighlightSearchText, ifoUseContainsOperator]
      Properties.KeyFieldNames = 'person_labor_place_id'
      Properties.ListColumns = <
        item
          FieldName = 'person_labour_place_name'
        end>
      Properties.ListSource = HOSxPPCUAccount2DataModule.LabourPlaceDS
      TabOrder = 1
      Width = 163
    end
    object cxDBLookupComboBox2: TcxDBLookupComboBox
      Left = 577
      Top = 19
      DataBinding.DataField = 'labor_doctor_type_id'
      DataBinding.DataSource = PersonANCDS
      Properties.IncrementalFilteringOptions = [ifoHighlightSearchText, ifoUseContainsOperator]
      Properties.KeyFieldNames = 'person_labour_doctor_type_id'
      Properties.ListColumns = <
        item
          FieldName = 'person_labour_doctor_type_name'
        end>
      Properties.ListSource = HOSxPPCUAccount2DataModule.LabourDoctorTypeDS
      TabOrder = 2
      Width = 163
    end
    object cxDBLookupComboBox3: TcxDBLookupComboBox
      Left = 97
      Top = 46
      DataBinding.DataField = 'labour_type_id'
      DataBinding.DataSource = PersonANCDS
      Properties.IncrementalFilteringOptions = [ifoHighlightSearchText, ifoUseContainsOperator]
      Properties.KeyFieldNames = 'person_labour_type_id'
      Properties.ListColumns = <
        item
          FieldName = 'person_labour_type_name'
        end>
      Properties.ListSource = HOSxPPCUAccount2DataModule.LabourTypeDS
      TabOrder = 3
      Width = 152
    end
    object cxDBLookupComboBox4: TcxDBLookupComboBox
      Left = 381
      Top = 46
      DataBinding.DataField = 'labour_hospcode'
      DataBinding.DataSource = PersonANCDS
      Properties.IncrementalFilteringOptions = [ifoHighlightSearchText, ifoUseContainsOperator]
      Properties.KeyFieldNames = 'hospcode'
      Properties.ListColumns = <
        item
          FieldName = 'hospname'
        end>
      Properties.ListSource = HOSxPPCUAccount2DataModule.HospcodeDS
      TabOrder = 4
      Width = 316
    end
    object cxButton9: TcxButton
      Left = 703
      Top = 46
      Width = 37
      Height = 22
      Caption = #3588#3657#3609
      TabOrder = 5
      OnClick = cxButton9Click
    end
    object cxDBButtonEdit1: TcxDBButtonEdit
      Left = 122
      Top = 73
      DataBinding.DataField = 'labor_icd10'
      DataBinding.DataSource = PersonANCDS
      Properties.Buttons = <
        item
          Default = True
          Kind = bkEllipsis
        end>
      Properties.OnButtonClick = cxDBButtonEdit1PropertiesButtonClick
      Properties.OnEditValueChanged = cxDBButtonEdit1PropertiesEditValueChanged
      TabOrder = 6
      Width = 127
    end
    object cxDBSpinEdit1: TcxDBSpinEdit
      Left = 152
      Top = 100
      DataBinding.DataField = 'alive_child_count'
      DataBinding.DataSource = PersonANCDS
      Properties.Alignment.Horz = taCenter
      TabOrder = 7
      Width = 97
    end
    object cxDBSpinEdit2: TcxDBSpinEdit
      Left = 152
      Top = 126
      DataBinding.DataField = 'dead_child_count'
      DataBinding.DataSource = PersonANCDS
      Properties.Alignment.Horz = taCenter
      TabOrder = 8
      Width = 97
    end
    object dxMemo: TcxMemo
      Left = 260
      Top = 72
      Lines.Strings = (
        '')
      Properties.ReadOnly = True
      Properties.ScrollBars = ssVertical
      TabOrder = 9
      Height = 52
      Width = 480
    end
    object cxButton1: TcxButton
      Left = 260
      Top = 126
      Width = 183
      Height = 25
      Caption = #3588#3633#3604#3621#3629#3585#3617#3634#3592#3634#3585#3586#3657#3629#3617#3641#3621#3585#3634#3619#3588#3621#3629#3604
      TabOrder = 10
      OnClick = cxButton1Click
    end
  end
  object PersonANCCDS: TClientDataSet
    Aggregates = <>
    CommandText = 'select * from person_anc  limit 0'#13#10
    Params = <>
    Left = 332
    Top = 207
  end
  object PersonANCDS: TDataSource
    DataSet = PersonANCCDS
    Left = 412
    Top = 204
  end
end
